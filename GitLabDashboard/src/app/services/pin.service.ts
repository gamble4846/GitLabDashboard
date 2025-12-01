import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class PinService {
  private readonly STORAGE_KEY = 'gitlab_pinned_repos';
  private _pinnedIds = signal<number[]>([]);
  pinnedIds = this._pinnedIds.asReadonly();

  constructor() {
    this.loadPinnedIds();
  }

  private loadPinnedIds(): void {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored) {
      try {
        const ids = JSON.parse(stored) as number[];
        this._pinnedIds.set(ids);
      } catch (e) {
        console.error('Failed to parse pinned repos', e);
        this.clearPinned();
      }
    }
  }

  private savePinnedIds(): void {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._pinnedIds()));
  }

  isPinned(projectId: number): boolean {
    return this._pinnedIds().includes(projectId);
  }

  togglePin(projectId: number): void {
    const current = [...this._pinnedIds()];
    const index = current.indexOf(projectId);
    if (index > -1) {
      current.splice(index, 1);
    } else {
      current.push(projectId);
    }
    this._pinnedIds.set(current);
    this.savePinnedIds();
  }

  reorderPinned(fromIndex: number, toIndex: number): void {
    const current = [...this._pinnedIds()];
    const [moved] = current.splice(fromIndex, 1);
    // Adjust toIndex: if moving down, we need to account for the removed item
    const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    current.splice(adjustedToIndex, 0, moved);
    this._pinnedIds.set(current);
    this.savePinnedIds();
  }

  getPinnedOrder(): number[] {
    return [...this._pinnedIds()];
  }

  setPinnedOrder(ids: number[]): void {
    this._pinnedIds.set([...ids]);
    this.savePinnedIds();
  }

  clearPinned(): void {
    this._pinnedIds.set([]);
    localStorage.removeItem(this.STORAGE_KEY);
  }
}


