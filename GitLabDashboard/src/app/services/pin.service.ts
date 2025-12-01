import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class PinService {
  private readonly STORAGE_KEY = 'gitlab_pinned_repos';
  private _pinnedIds = signal<Set<number>>(new Set());
  pinnedIds = this._pinnedIds.asReadonly();

  constructor() {
    this.loadPinnedIds();
  }

  private loadPinnedIds(): void {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored) {
      try {
        const ids = JSON.parse(stored) as number[];
        this._pinnedIds.set(new Set(ids));
      } catch (e) {
        console.error('Failed to parse pinned repos', e);
        this.clearPinned();
      }
    }
  }

  private savePinnedIds(): void {
    const ids = Array.from(this._pinnedIds());
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(ids));
  }

  isPinned(projectId: number): boolean {
    return this._pinnedIds().has(projectId);
  }

  togglePin(projectId: number): void {
    const current = new Set(this._pinnedIds());
    if (current.has(projectId)) {
      current.delete(projectId);
    } else {
      current.add(projectId);
    }
    this._pinnedIds.set(current);
    this.savePinnedIds();
  }

  clearPinned(): void {
    this._pinnedIds.set(new Set());
    localStorage.removeItem(this.STORAGE_KEY);
  }
}

