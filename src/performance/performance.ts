import { Injectable, NgZone, ApplicationRef, InjectionToken, Inject, Optional } from '@angular/core';
import { Observable, Subscription, from } from 'rxjs';
import { first, tap, map, shareReplay, switchMap } from 'rxjs/operators';
import { performance } from 'firebase/app';
import { FirebaseApp } from '@angular/fire';

export const AUTOMATICALLY_TRACE_CORE_NG_METRICS = new InjectionToken<boolean>('angularfire2.performance.auto_trace');
export const INSTRUMENTATION_ENABLED = new InjectionToken<boolean>('angularfire2.performance.instrumentationEnabled');
export const DATA_COLLECTION_ENABLED = new InjectionToken<boolean>('angularfire2.performance.dataCollectionEnabled');

export type TraceOptions = {
  metrics?: {[key:string]: number},
  attributes?: {[key:string]:string},
  attribute$?: {[key:string]:Observable<string>},
  incrementMetric$?: {[key:string]: Observable<number|void|null|undefined>},
  metric$?: {[key:string]: Observable<number>}
};

@Injectable()
export class AngularFirePerformance {
  
  performance: Observable<performance.Performance>;

  constructor(
    app: FirebaseApp,
    @Optional() @Inject(AUTOMATICALLY_TRACE_CORE_NG_METRICS) automaticallyTraceCoreNgMetrics:boolean|null,
    @Optional() @Inject(INSTRUMENTATION_ENABLED) instrumentationEnabled:boolean|null,
    @Optional() @Inject(DATA_COLLECTION_ENABLED) dataCollectionEnabled:boolean|null,
    appRef: ApplicationRef,
    private zone: NgZone
  ) {
    
    // @ts-ignore zapping in the UMD in the build script
    const requirePerformance = from(zone.runOutsideAngular(() => import('firebase/performance')));

    this.performance = requirePerformance.pipe(
      // SEMVER while < 6 need to type, drop next major
      map(() => zone.runOutsideAngular(() => <performance.Performance>app.performance())),
      tap(performance => {
        if (instrumentationEnabled == false) { performance.instrumentationEnabled = false }
        if (dataCollectionEnabled == false) { performance.dataCollectionEnabled = false }
      }),
      shareReplay(1)
    );

    if (automaticallyTraceCoreNgMetrics != false) {

      // TODO determine more built in metrics
      appRef.isStable.pipe(
        first(it => it),
        this.traceUntilComplete('isStable')
      ).subscribe();

    }

  }

  trace$ = (name:string, options?: TraceOptions) =>
    this.performance.pipe(
      switchMap(performance =>
        new Observable<void>(emitter =>
          this.zone.runOutsideAngular(() => {
            const trace = performance.trace(name);
            options && options.metrics && Object.keys(options.metrics).forEach(metric => {
              trace.putMetric(metric, options!.metrics![metric])
            });
            options && options.attributes && Object.keys(options.attributes).forEach(attribute => {
              trace.putAttribute(attribute, options!.attributes![attribute])
            });
            const attributeSubscriptions = options && options.attribute$ ? Object.keys(options.attribute$).map(attribute =>
              options!.attribute$![attribute].subscribe(next => trace.putAttribute(attribute, next))
            ) : [];
            const metricSubscriptions = options && options.metric$ ? Object.keys(options.metric$).map(metric =>
              options!.metric$![metric].subscribe(next => trace.putMetric(metric, next))
            ) : [];
            const incrementOnSubscriptions = options && options.incrementMetric$ ? Object.keys(options.incrementMetric$).map(metric =>
              options!.incrementMetric$![metric].subscribe(next => trace.incrementMetric(metric, next || undefined))
            ) : [];
            emitter.next(trace.start());
            return { unsubscribe: () => {
              trace.stop();
              metricSubscriptions.forEach(m => m.unsubscribe());
              incrementOnSubscriptions.forEach(m => m.unsubscribe());
              attributeSubscriptions.forEach(m => m.unsubscribe());
            }};
          })
        )
      )
    );

  traceUntil = <T=any>(name:string, test: (a:T) => boolean, options?: TraceOptions & { orComplete?: boolean }) => (source$: Observable<T>) => new Observable<T>(subscriber => {
    const traceSubscription = this.trace$(name, options).subscribe();
    return source$.pipe(
      tap(
        a  => test(a) && traceSubscription.unsubscribe(),
        () => {},
        () => options && options.orComplete && traceSubscription.unsubscribe()
      )
    ).subscribe(subscriber);
  });

  traceWhile = <T=any>(name:string, test: (a:T) => boolean, options?: TraceOptions & { orComplete?: boolean}) => (source$: Observable<T>) => new Observable<T>(subscriber => {
    let traceSubscription: Subscription|undefined;
    return source$.pipe(
      tap(
        a  => {
          if (test(a)) {
            traceSubscription = traceSubscription || this.trace$(name, options).subscribe();
          } else {
            traceSubscription && traceSubscription.unsubscribe();
            traceSubscription = undefined;
          }
        },
        () => {},
        () => options && options.orComplete && traceSubscription && traceSubscription.unsubscribe()
      )
    ).subscribe(subscriber);
  });

  traceUntilComplete = <T=any>(name:string, options?: TraceOptions) => (source$: Observable<T>) => new Observable<T>(subscriber => {
    const traceSubscription = this.trace$(name, options).subscribe();
    return source$.pipe(
      tap(
        () => {},
        () => {},
        () => traceSubscription.unsubscribe()
      )
    ).subscribe(subscriber);
  });

  traceUntilFirst = <T=any>(name:string, options?: TraceOptions) => (source$: Observable<T>) => new Observable<T>(subscriber => {
    const traceSubscription = this.trace$(name, options).subscribe();
    return source$.pipe(
      tap(
        () => traceSubscription.unsubscribe(),
        () => {},
        () => {}
      )
    ).subscribe(subscriber);
  });

  trace = <T=any>(name:string, options?: TraceOptions) => (source$: Observable<T>) => new Observable<T>(subscriber => {
    const traceSubscription = this.trace$(name, options).subscribe();
    return source$.pipe(
      tap(
        () => traceSubscription.unsubscribe(),
        () => {},
        () => traceSubscription.unsubscribe()
      )
    ).subscribe(subscriber);
  });

}
