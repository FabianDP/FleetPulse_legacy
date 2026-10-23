import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';

export type StreamEventType=
| 'vehicle.updated'
| 'alert.created'
| 'stream.reconnected';

@Injectable({
  providedIn: 'root',
})
export class StreamService {
  readonly connectionStatus = signal<'connecting' | 'connected' | 'reconnecting' | 'closed'>('connecting');
  private readonly zone = inject(NgZone);
  private readonly streamUrl = 'http://localhost:3000/api/stream';

  connect(): Observable<StreamEventType> {
    return new Observable<StreamEventType>((subscriber) => {
      const source = new EventSource(this.streamUrl);
      this.connectionStatus.set('connecting');
      let hasConnected=false;

      const onUpdate = () => {
        this.zone.run(() => subscriber.next('vehicle.updated'));
      };

      const onAlert = () => {
        this.zone.run(() => subscriber.next('alert.created'));
      };
      source.onopen=()=>{
        this.zone.run(() => this.connectionStatus.set('connected'));
        if (hasConnected){
          console.warn("SSE reconectado. Actualizando datos...");
          this.zone.run(()=> subscriber.next('stream.reconnected'));
        }
        hasConnected =true;
      };

      source.addEventListener('vehicle.updated', onUpdate);
      source.addEventListener('alert.created', onAlert);

      source.onerror = () => {
        this.zone.run(() => this.connectionStatus.set(source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting'));
        // EventSource intenta reconectarse automáticamente.
        console.warn('SSE desconectado. Esperando reconexión...');
      };

      return () => {
        source.removeEventListener('vehicle.updated', onUpdate);
        source.removeEventListener('alert.created', onAlert);
        source.onopen=null;
        source.onerror=null;
        source.close();
        this.connectionStatus.set('closed');
      };
    });
  }
}
