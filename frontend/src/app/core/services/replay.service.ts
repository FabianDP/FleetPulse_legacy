import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export type ReplayState = 'idle' | 'running' | 'paused' | 'completed' | 'error';
export type ReplayAction = 'start' | 'pause' | 'resume' | 'restart';
export interface ReplayProgress {
  state: ReplayState;
  processed: number;
  total: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  intervalMs: number;
  errors: { index: number; eventId?: string; reason: string }[];
}

@Injectable({ providedIn: 'root' })
export class ReplayService {
  private readonly http = inject(HttpClient);
  private readonly url = 'http://localhost:3000/api/replay';
  readonly loginUrl = `${this.url}/login`;

  status() {
    return this.http.get<ReplayProgress>(this.url, { withCredentials: true });
  }

  control(action: ReplayAction, intervalMs: number) {
    return this.http.post<ReplayProgress>(`${this.url}/${action}`,
      action === 'pause' ? {} : { intervalMs }, { withCredentials: true });
  }
}
