import { Routes } from '@angular/router';
import { authGuard, loginGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./components/login/login.component').then(m => m.LoginComponent),
    canActivate: [loginGuard]
  },
  {
    path: 'pipelines',
    loadComponent: () => import('./components/pipelines/pipelines.component').then(m => m.PipelinesComponent),
    canActivate: [authGuard]
  },
  {
    path: '',
    redirectTo: '/pipelines',
    pathMatch: 'full'
  }
];
