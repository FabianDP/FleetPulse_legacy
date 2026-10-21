import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, exhaustMap, finalize, tap, timer } from 'rxjs';
import { ReplayAction, ReplayProgress, ReplayService } from '../core/services/replay.service';

@Component({
  selector: 'app-replay-controls',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './replay-controls.component.html',
  styleUrl: './replay-controls.component.css'
})
export class ReplayControlsComponent implements OnInit {
  private readonly replay = inject(ReplayService);
  private readonly destroyRef = inject(DestroyRef);
  private revision = 0;
  readonly loginUrl = this.replay.loginUrl;
  progress?: ReplayProgress;
  intervalMs = 750;
  busy = false;
  authorized = false;
  error = '';
  readonly labels = { idle: 'Listo', running: 'Reproduciendo', paused: 'Pausado', completed: 'Completado', error: 'Error; puede reintentar con Reanudar' };

  get validInterval(): boolean {
    return Number.isInteger(this.intervalMs) && this.intervalMs >= 100 && this.intervalMs <= 60000;
  }

  ngOnInit(): void {
    timer(0, 750).pipe(
      exhaustMap(() => {
        if (this.busy) return EMPTY;
        const revision = this.revision;
        return this.replay.status().pipe(
          tap(progress => {
            if (revision === this.revision) {
              if (!this.progress) this.intervalMs = progress.intervalMs;
              this.progress = progress;
              this.authorized = true;
              this.error = '';
            }
          }),
          catchError((error: HttpErrorResponse) => {
            if (revision === this.revision) this.showError(error);
            return EMPTY;
          })
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  control(action: ReplayAction): void {
    if (this.busy || !this.authorized || !this.validInterval) return;
    this.busy = true;
    this.revision++;
    this.replay.control(action, this.intervalMs).pipe(
      finalize(() => { this.busy = false; }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: progress => { this.progress = progress; this.error = ''; },
      error: (error: HttpErrorResponse) => this.showError(error)
    });
  }

  private showError(error: HttpErrorResponse): void {
    if (error.status === 401 || error.status === 403) {
      this.authorized = false;
      this.error = 'Autorice este navegador para controlar la reproducción.';
    } else if (error.status === 503) {
      this.authorized = false;
      this.error = 'La reproducción local no está disponible. Revise la configuración del servidor.';
    } else if (error.status === 409) {
      this.error = 'La reproducción cambió desde otro control. Espere la actualización e inténtelo de nuevo.';
    } else {
      this.error = 'No se pudo comunicar con el reproductor. Se reintentará la consulta.';
    }
  }
}
