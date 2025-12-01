import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GitLabService, ProjectWithPipeline } from '../../services/gitlab.service';
import { interval, Subscription } from 'rxjs';

@Component({
  selector: 'app-pipelines',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pipelines.component.html',
  styleUrl: './pipelines.component.css'
})
export class PipelinesComponent implements OnInit, OnDestroy {
  private gitlabService = inject(GitLabService);
  
  projects = signal<ProjectWithPipeline[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  
  private refreshSubscription?: Subscription;
  private readonly REFRESH_INTERVAL = 10000; // 10 seconds

  ngOnInit(): void {
    this.loadPipelines();
    // Auto-refresh every few seconds
    this.refreshSubscription = interval(this.REFRESH_INTERVAL).subscribe(() => {
      this.loadPipelines();
    });
  }

  ngOnDestroy(): void {
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
    }
  }

  loadPipelines(): void {
    this.loading.set(true);
    this.error.set(null);
    
    this.gitlabService.getProjectsWithPipelines().subscribe({
      next: (projects) => {
        this.projects.set(projects);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading pipelines:', err);
        this.error.set('Failed to load pipelines. Please check your credentials.');
        this.loading.set(false);
      }
    });
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

