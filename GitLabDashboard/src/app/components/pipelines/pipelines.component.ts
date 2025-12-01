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
    const pinnedOrder = this.pinService.getPinnedOrder();
    const pinnedMap = new Map(this.projects().filter(p => pinnedOrder.includes(p.id)).map(p => [p.id, p]));
    // Return projects in the order specified by pinnedOrder
    return pinnedOrder.map(id => pinnedMap.get(id)).filter((p): p is ProjectWithPipeline => p !== undefined);
  });
  
  draggingIndex = signal<number | null>(null);
  dragOverIndex = signal<number | null>(null);
  
  otherProjects = computed(() => {
    const pinnedIds = this.pinService.pinnedIds();
    const pinnedSet = new Set(pinnedIds);
    return this.projects().filter(p => !pinnedSet.has(p.id));
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

  onDragStart(event: DragEvent, index: number, dragElement: any): void {
    if (!event.dataTransfer) return;
    
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', index.toString());
    this.draggingIndex.set(index);
    
    // Create a custom drag image (ghost)
    const handleElement = dragElement as HTMLElement;
    const cardElement = handleElement?.closest('.project-card') as HTMLElement;
    if (cardElement) {
      // Clone the card for the ghost
      const ghost = cardElement.cloneNode(true) as HTMLElement;
      ghost.style.width = cardElement.offsetWidth + 'px';
      ghost.style.opacity = '0.9';
      ghost.style.transform = 'rotate(2deg)';
      ghost.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.4)';
      ghost.style.position = 'absolute';
      ghost.style.top = '-1000px';
      ghost.style.left = '-1000px';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '10000';
      document.body.appendChild(ghost);
      
      // Set the drag image
      const rect = cardElement.getBoundingClientRect();
      event.dataTransfer.setDragImage(ghost, rect.width / 2, rect.height / 2);
      
      // Clean up after a short delay
      setTimeout(() => {
        if (document.body.contains(ghost)) {
          document.body.removeChild(ghost);
        }
      }, 0);
      
      // Make the original card semi-transparent
      cardElement.style.opacity = '0.5';
    }
  }

  onDragEnd(event: DragEvent): void {
    this.draggingIndex.set(null);
    this.dragOverIndex.set(null);
    
    // Restore opacity of all cards
    const cards = document.querySelectorAll('.project-card');
    cards.forEach(card => {
      if (card instanceof HTMLElement) {
        card.style.opacity = '1';
      }
    });
  }

  onDragOver(event: DragEvent, index: number): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    
    const dragIndex = this.draggingIndex();
    // Only show drop indicator if dragging to a different position
    if (dragIndex !== null && dragIndex !== index) {
      this.dragOverIndex.set(index);
    } else {
      this.dragOverIndex.set(null);
    }
  }

  onDragLeave(): void {
    // Don't clear immediately to prevent flickering
    // Will be cleared when entering a new drop zone
  }

  onDrop(event: DragEvent, dropIndex: number): void {
    event.preventDefault();
    const dragIndex = this.draggingIndex();
    
    if (dragIndex !== null && dragIndex !== dropIndex) {
      this.pinService.reorderPinned(dragIndex, dropIndex);
    }
    
    this.draggingIndex.set(null);
    this.dragOverIndex.set(null);
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
        const pinnedOrder = this.pinService.getPinnedOrder();
        const pinnedSet = new Set(pinnedOrder);
        const pinnedProjects = projects.filter(p => pinnedSet.has(p.id));
        const otherProjects = projects.filter(p => !pinnedSet.has(p.id));
        
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

