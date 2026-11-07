interface ResetScope {
  skipWaiting():Promise<void>;registration:{unregister():Promise<boolean>};clients:{claim():Promise<void>};
  addEventListener(name:string,listener:(event:{waitUntil(work:Promise<unknown>):void})=>void):void;
}
const worker=globalThis as unknown as ResetScope;
worker.addEventListener('install',()=>{void worker.skipWaiting();});
worker.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())await caches.delete(key);
  await worker.registration.unregister();await worker.clients.claim();
})()));
