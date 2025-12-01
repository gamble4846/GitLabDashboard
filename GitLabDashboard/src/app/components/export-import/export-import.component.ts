import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PinService } from '../../services/pin.service';

interface ExportData {
  version: string;
  credentials?: {
    username: string;
    token: string;
  };
  pinnedRepos?: number[];
  exportDate: string;
}

@Component({
  selector: 'app-export-import',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './export-import.component.html',
  styleUrl: './export-import.component.css'
})
export class ExportImportComponent {
  private authService = inject(AuthService);
  private pinService = inject(PinService);
  private router = inject(Router);

  exportData = '';
  importData = '';
  importError = '';
  importSuccess = false;
  
  get isLoggedIn(): boolean {
    return this.authService.hasCredentials();
  }

  exportUserData(): void {
    const data: ExportData = {
      version: '1.0',
      exportDate: new Date().toISOString()
    };

    // Export credentials if available
    const credentials = this.authService.getCredentials();
    if (credentials) {
      data.credentials = {
        username: credentials.username,
        token: credentials.token
      };
    }

    // Export pinned repos
    const pinnedRepos = this.pinService.getPinnedOrder();
    if (pinnedRepos.length > 0) {
      data.pinnedRepos = pinnedRepos;
    }

    this.exportData = JSON.stringify(data, null, 2);
    this.importError = '';
    this.importSuccess = false;
  }

  copyToClipboard(): void {
    if (this.exportData) {
      navigator.clipboard.writeText(this.exportData).then(() => {
        // Show success feedback
        const button = document.querySelector('.copy-button') as HTMLElement;
        if (button) {
          const originalText = button.textContent;
          button.textContent = 'Copied!';
          setTimeout(() => {
            if (button) button.textContent = originalText;
          }, 2000);
        }
      }).catch(err => {
        console.error('Failed to copy:', err);
        this.importError = 'Failed to copy to clipboard';
      });
    }
  }

  downloadFile(): void {
    if (this.exportData) {
      const blob = new Blob([this.exportData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gitlab-dashboard-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  onImportChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        this.importData = content;
        this.importError = '';
        this.importSuccess = false;
      };
      reader.readAsText(file);
    }
  }

  importUserData(): void {
    this.importError = '';
    this.importSuccess = false;

    if (!this.importData.trim()) {
      this.importError = 'Please paste or upload import data';
      return;
    }

    try {
      const data: ExportData = JSON.parse(this.importData);

      // Validate version
      if (!data.version) {
        this.importError = 'Invalid export file: missing version';
        return;
      }

      let imported = false;

      // Import credentials
      if (data.credentials) {
        if (!data.credentials.username || !data.credentials.token) {
          this.importError = 'Invalid credentials data';
          return;
        }
        this.authService.saveCredentials(data.credentials.username, data.credentials.token);
        imported = true;
      }

      // Import pinned repos
      if (data.pinnedRepos && Array.isArray(data.pinnedRepos)) {
        // Validate all items are numbers
        if (data.pinnedRepos.every(id => typeof id === 'number')) {
          this.pinService.setPinnedOrder(data.pinnedRepos);
          imported = true;
        } else {
          this.importError = 'Invalid pinned repos data: must be array of numbers';
          return;
        }
      }

      if (imported) {
        this.importSuccess = true;
        this.importData = '';
        // Clear file input
        const fileInput = document.querySelector('.file-input') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
        
        // If credentials were imported, redirect to pipelines
        if (data.credentials) {
          setTimeout(() => {
            this.router.navigate(['/pipelines']);
          }, 1500);
        } else {
          setTimeout(() => {
            this.importSuccess = false;
          }, 3000);
        }
      } else {
        this.importError = 'No valid data found in import file';
      }
    } catch (error) {
      console.error('Import error:', error);
      this.importError = 'Invalid JSON format. Please check your import data.';
    }
  }

  clearImport(): void {
    this.importData = '';
    this.importError = '';
    this.importSuccess = false;
    const fileInput = document.querySelector('.file-input') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  }
}

