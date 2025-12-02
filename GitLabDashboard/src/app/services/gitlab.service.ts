import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { AuthService } from './auth.service';

export interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
}

export interface GitLabJob {
  id: number;
  status: 'success' | 'failed' | 'running' | 'pending' | 'canceled' | 'skipped';
  name: string;
  stage: string;
}

export interface GitLabPipeline {
  id: number;
  status: 'success' | 'failed' | 'running' | 'pending' | 'canceled' | 'skipped';
  ref: string;
  sha: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  jobs?: GitLabJob[];
}

export interface ProjectWithPipeline extends GitLabProject {
  pipeline: GitLabPipeline | null;
}

@Injectable({
  providedIn: 'root'
})
export class GitLabService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  private getBaseUrl(): string {
    // Default to gitlab.com, but can be configured
    return 'https://gitlab.com/api/v4';
  }

  private getHeaders(): HttpHeaders {
    const credentials = this.authService.getCredentials();
    if (!credentials) {
      throw new Error('No credentials available');
    }
    return new HttpHeaders({
      'PRIVATE-TOKEN': credentials.token
    });
  }

  getProjects(): Observable<GitLabProject[]> {
    const headers = this.getHeaders();
    return this.http.get<GitLabProject[]>(`${this.getBaseUrl()}/projects?membership=true&per_page=100`, { headers });
  }

  getLatestPipeline(projectId: number): Observable<GitLabPipeline | null> {
    const headers = this.getHeaders();
    return this.http.get<GitLabPipeline[]>(
      `${this.getBaseUrl()}/projects/${projectId}/pipelines?per_page=1`,
      { headers }
    ).pipe(
      map(pipelines => pipelines.length > 0 ? pipelines[0] : null),
      catchError(() => of(null))
    );
  }

  getProjectsWithPipelines(): Observable<ProjectWithPipeline[]> {
    return this.getProjects().pipe(
      switchMap(projects => {
        if (projects.length === 0) {
          return of([] as ProjectWithPipeline[]);
        }
        const pipelineRequests = projects.map(project =>
          this.getLatestPipeline(project.id).pipe(
            map(pipeline => ({ ...project, pipeline } as ProjectWithPipeline))
          )
        );
        return forkJoin(pipelineRequests);
      })
    );
  }

  retryPipeline(projectId: number, pipelineId: number): Observable<GitLabPipeline> {
    const headers = this.getHeaders();
    return this.http.post<GitLabPipeline>(
      `${this.getBaseUrl()}/projects/${projectId}/pipelines/${pipelineId}/retry`,
      {},
      { headers }
    );
  }

  getPipelineJobs(projectId: number, pipelineId: number): Observable<GitLabJob[]> {
    const headers = this.getHeaders();
    return this.http.get<GitLabJob[]>(
      `${this.getBaseUrl()}/projects/${projectId}/pipelines/${pipelineId}/jobs`,
      { headers }
    ).pipe(
      catchError(() => of([]))
    );
  }
}

