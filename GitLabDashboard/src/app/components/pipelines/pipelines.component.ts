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
  loadingPinned = signal(false);
  loadingOthers = signal(false);
  error = signal<string | null>(null);
  
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

  loadPipelinesOptimized(): void {
    this.error.set(null);
    
    // Load projects first
    this.loading.set(true);
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
                this.projects.set(combined);
                this.loading.set(false);
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
                this.loadingOthers.set(false);
              }, []);
            }
          });
        } else {
          // No pinned projects, load all in batches
          this.loadingOthers.set(true);
          this.loadProjectsInBatches(otherProjects, (allWithPipelines) => {
            this.projects.set(allWithPipelines);
            this.loading.set(false);
            this.loadingOthers.set(false);
          });
        }
      },
      error: (err) => {
        console.error('Error loading projects:', err);
        this.error.set('Failed to load projects. Please check your credentials.');
        this.loading.set(false);
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
    
    batches.forEach((batch, index) => {
      this.loadPipelinesForProjects(batch).subscribe({
        next: (batchResults) => {
          results.push(...batchResults);
          completedBatches++;
          
          // Update UI progressively as batches complete
          if (index === 0) {
            // First batch - show immediately with pinned projects
            this.projects.set([...pinnedProjects, ...results]);
          } else {
            // Update with all loaded so far
            this.projects.set([...pinnedProjects, ...results]);
          }
          
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
          
          // Update UI even on error
          this.projects.set([...pinnedProjects, ...results]);
          
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
}

