import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  username = '';
  token = '';
  error = '';

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  onSubmit(): void {
    if (!this.username.trim() || !this.token.trim()) {
      this.error = 'Please enter both username and token';
      return;
    }

    this.error = '';
    this.authService.saveCredentials(this.username.trim(), this.token.trim());
    this.router.navigate(['/pipelines']);
  }
}

