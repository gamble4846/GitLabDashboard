import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GitLabService, ProjectWithPipeline, GitLabProject } from '../../services/gitlab.service';
import { PinService } from '../../services/pin.service';
import { interval, Subscription, forkJoin, of, Observable } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-pipelines',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pipelines.component.html',
  styleUrl: './pipelines.component.css'
})
export class PipelinesComponent implements OnInit, OnDestroy {
  private gitlabService = inject(GitLabService);
  private pinService = inject(PinService);
  
  projects = signal<ProjectWithPipeline[]>([]);
  loading = signal(true);
  refreshing = signal(false);
  loadingPinned = signal(false);
  loadingOthers = signal(false);
  error = signal<string | null>(null);
  retryingPipelines = signal<Set<number>>(new Set());
  
  pinnedProjects = computed(() => {
    const pinnedIds = this.pinService.pinnedIds();
    return this.projects().filter(p => pinnedIds.has(p.id));
  });
  
  otherProjects = computed(() => {
    const pinnedIds = this.pinService.pinnedIds();
    return this.projects().filter(p => !pinnedIds.has(p.id));
  });
  
  private refreshSubscription?: Subscription;
  private readonly REFRESH_INTERVAL = 10000; // 10 seconds
  private readonly BATCH_SIZE = 10; // Load pipelines in batches of 10

  ngOnInit(): void {
    this.loadPipelinesOptimized();
    // Auto-refresh every few seconds
    this.refreshSubscription = interval(this.REFRESH_INTERVAL).subscribe(() => {
      this.loadPipelinesOptimized();
    });
  }

  ngOnDestroy(): void {
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
    }
  }

  togglePin(projectId: number): void {
    this.pinService.togglePin(projectId);
  }

  isPinned(projectId: number): boolean {
    return this.pinService.isPinned(projectId);
  }

  isRetrying(projectId: number): boolean {
    return this.retryingPipelines().has(projectId);
  }

  retryPipeline(project: ProjectWithPipeline): void {
    if (!project.pipeline) {
      return;
    }

    const projectId = project.id;
    const pipelineId = project.pipeline.id;

    // Add to retrying set
    const retrying = new Set(this.retryingPipelines());
    retrying.add(projectId);
    this.retryingPipelines.set(retrying);

    this.gitlabService.retryPipeline(projectId, pipelineId).subscribe({
      next: (newPipeline) => {
        // Update the project's pipeline with the new retried pipeline
        const updatedProjects = this.projects().map(p => 
          p.id === projectId 
            ? { ...p, pipeline: newPipeline } 
            : p
        );
        this.projects.set(updatedProjects);
        
        // Remove from retrying set
        const retryingSet = new Set(this.retryingPipelines());
        retryingSet.delete(projectId);
        this.retryingPipelines.set(retryingSet);
      },
      error: (err) => {
        console.error('Error retrying pipeline:', err);
        // Remove from retrying set on error
        const retryingSet = new Set(this.retryingPipelines());
        retryingSet.delete(projectId);
        this.retryingPipelines.set(retryingSet);
        
        // Show error message (you could add a toast notification here)
        alert('Failed to retry pipeline. Please try again.');
      }
    });
  }

  loadPipelinesOptimized(): void {
    this.error.set(null);
    
    // Check if this is a refresh (we already have projects)
    const isRefresh = this.projects().length > 0;
    
    if (isRefresh) {
      // For refreshes, show refreshing indicator but keep old content
      this.refreshing.set(true);
    } else {
      // For initial load, show loading state
      this.loading.set(true);
    }
    
    // Load projects first
    this.gitlabService.getProjects().subscribe({
      next: (projects) => {
        // Separate pinned and other projects
        const pinnedIds = this.pinService.pinnedIds();
        const pinnedProjects = projects.filter(p => pinnedIds.has(p.id));
        const otherProjects = projects.filter(p => !pinnedIds.has(p.id));
        
        // Load pinned projects first (priority)
        if (pinnedProjects.length > 0) {
          this.loadingPinned.set(true);
          this.loadPipelinesForProjects(pinnedProjects).subscribe({
            next: (pinnedWithPipelines) => {
              // Load other projects in batches for better performance
              this.loadingPinned.set(false);
              this.loadingOthers.set(true);
              
              this.loadProjectsInBatches(otherProjects, (allWithPipelines) => {
                // Combine and sort: pinned first, then others
                const combined = [...pinnedWithPipelines, ...allWithPipelines];
                // Only update projects once all data is loaded to prevent layout shift
                this.projects.set(combined);
                this.loading.set(false);
                this.refreshing.set(false);
                this.loadingOthers.set(false);
              }, pinnedWithPipelines);
            },
            error: (err) => {
              console.error('Error loading pinned pipelines:', err);
              this.loadingPinned.set(false);
              // Continue loading others even if pinned fails
              this.loadProjectsInBatches(otherProjects, (allWithPipelines) => {
                this.projects.set(allWithPipelines);
                this.loading.set(false);
                this.refreshing.set(false);
                this.loadingOthers.set(false);
              }, []);
            }
          });
        } else {
          // No pinned projects, load all in batches
          this.loadingOthers.set(true);
          this.loadProjectsInBatches(otherProjects, (allWithPipelines) => {
            // Only update projects once all data is loaded
            this.projects.set(allWithPipelines);
            this.loading.set(false);
            this.refreshing.set(false);
            this.loadingOthers.set(false);
          });
        }
      },
      error: (err) => {
        console.error('Error loading projects:', err);
        this.error.set('Failed to load projects. Please check your credentials.');
        this.loading.set(false);
        this.refreshing.set(false);
        this.loadingPinned.set(false);
        this.loadingOthers.set(false);
      }
    });
  }

  private loadPipelinesForProjects(projects: GitLabProject[]): Observable<ProjectWithPipeline[]> {
    if (projects.length === 0) {
      return of([]);
    }
    
    const pipelineRequests = projects.map(project =>
      this.gitlabService.getLatestPipeline(project.id).pipe(
        map(pipeline => ({ ...project, pipeline } as ProjectWithPipeline)),
        catchError(() => of({ ...project, pipeline: null } as ProjectWithPipeline))
      )
    );
    
    return forkJoin(pipelineRequests);
  }

  private loadProjectsInBatches(
    projects: GitLabProject[], 
    callback: (results: ProjectWithPipeline[]) => void,
    pinnedProjects: ProjectWithPipeline[] = []
  ): void {
    if (projects.length === 0) {
      callback([]);
      return;
    }
    
    const batches: any[][] = [];
    for (let i = 0; i < projects.length; i += this.BATCH_SIZE) {
      batches.push(projects.slice(i, i + this.BATCH_SIZE));
    }
    
    const results: ProjectWithPipeline[] = [];
    let completedBatches = 0;
    const isInitialLoad = this.projects().length === 0;
    
    batches.forEach((batch, index) => {
      this.loadPipelinesForProjects(batch).subscribe({
        next: (batchResults) => {
          results.push(...batchResults);
          completedBatches++;
          
          // Only update UI progressively on initial load (when no projects exist)
          // On refresh, wait until all batches are complete to prevent layout shift
          if (isInitialLoad && index === 0) {
            // First batch on initial load - show immediately with pinned projects
            this.projects.set([...pinnedProjects, ...results]);
          } else if (isInitialLoad) {
            // Subsequent batches on initial load - update progressively
            this.projects.set([...pinnedProjects, ...results]);
          }
          // On refresh, don't update until all batches complete
          
          if (completedBatches === batches.length) {
            callback(results);
          }
        },
        error: (err) => {
          console.error(`Error loading batch ${index}:`, err);
          // Add projects without pipelines on error
          const batchWithoutPipelines = batch.map(p => ({ ...p, pipeline: null } as ProjectWithPipeline));
          results.push(...batchWithoutPipelines);
          completedBatches++;
          
          // Only update UI on error if it's initial load
          if (isInitialLoad) {
            this.projects.set([...pinnedProjects, ...results]);
          }
          
          if (completedBatches === batches.length) {
            callback(results);
          }
        }
      });
    });
  }

  // Legacy method for fallback
  loadPipelines(): void {
    this.loadPipelinesOptimized();
  }

  getStatusClass(status: string | null | undefined): string {
    if (!status) return 'pipeline-status-pending';
    return `pipeline-status-${status.toLowerCase()}`;
  }

  getStatusIcon(status: string | null | undefined): string {
    if (!status) return '⏳';
    switch (status.toLowerCase()) {
      case 'success': return '✓';
      case 'failed': return '✗';
      case 'running': return '⟳';
      case 'pending': return '⏳';
      case 'canceled': return '⊘';
      default: return '?';
    }
  }

  canRetryPipeline(status: string | null | undefined): boolean {
    if (!status) return false;
    const lowerStatus = status.toLowerCase();
    // Can retry: failed, canceled, skipped
    // Cannot retry: success, running, pending
    return lowerStatus === 'failed' || lowerStatus === 'canceled' || lowerStatus === 'skipped';
  }
}

