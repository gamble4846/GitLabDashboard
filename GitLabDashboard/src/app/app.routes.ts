import { Routes } from '@angular/router';
import { authGuard, loginGuard } from './guards/auth.guard';
import { homeGuard } from './guards/home.guard';

export const routes: Routes = [
  {
    path: 'home',
    loadComponent: () => import('./components/home/home.component').then(m => m.HomeComponent),
    canActivate: [homeGuard]
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
    path: 'settings',
    loadComponent: () => import('./components/export-import/export-import.component').then(m => m.ExportImportComponent)
  },
  {
    path: '',
    redirectTo: '/login',
    pathMatch: 'full'
  }
];
