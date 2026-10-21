import { Injectable, NgZone, inject } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class StreamService {
  private readonly zone = inject(NgZone);
  private readonly streamUrl = 'http://localhost:3000/api/stream';

  connect(): Observable<string> {
    return new Observable<string>((subscriber) => {
      const source = new EventSource(this.streamUrl);

      const onUpdate = () => {
        this.zone.run(() => subscriber.next('vehicle.updated'));
      };

      const onAlert = () => {
        this.zone.run(() => subscriber.next('alert.created'));
      };

      source.addEventListener('vehicle.updated', onUpdate);
      source.addEventListener('alert.created', onAlert);

      source.onerror = () => {
        // EventSource intenta reconectarse automáticamente.
        console.warn('SSE desconectado. Esperando reconexión...');
      };

      return () => {
        source.removeEventListener('vehicle.updated', onUpdate);
        source.removeEventListener('alert.created', onAlert);
        source.close();
      };
    });
  }
}
