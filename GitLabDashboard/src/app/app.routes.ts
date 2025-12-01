import { Routes } from '@angular/router';
import { authGuard, loginGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'home',
    loadComponent: () => import('./components/home/home.component').then(m => m.HomeComponent)
  },
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
    redirectTo: '/home',
    pathMatch: 'full'
  }
];
