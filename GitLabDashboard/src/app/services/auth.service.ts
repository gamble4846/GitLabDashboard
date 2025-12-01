import { Injectable, signal } from '@angular/core';

export interface AuthCredentials {
  username: string;
  token: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly STORAGE_KEY = 'gitlab_auth_credentials';
  
  private _credentials = signal<AuthCredentials | null>(null);
  credentials = this._credentials.asReadonly();

  constructor() {
    this.loadCredentials();
  }

  private loadCredentials(): void {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored) {
      try {
        const credentials = JSON.parse(stored) as AuthCredentials;
        this._credentials.set(credentials);
      } catch (e) {
        console.error('Failed to parse stored credentials', e);
        this.clearCredentials();
      }
    }
  }

  saveCredentials(username: string, token: string): void {
    const credentials: AuthCredentials = { username, token };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(credentials));
    this._credentials.set(credentials);
  }

  clearCredentials(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    this._credentials.set(null);
  }

  hasCredentials(): boolean {
    return this._credentials() !== null;
  }

  getCredentials(): AuthCredentials | null {
    return this._credentials();
  }
}

