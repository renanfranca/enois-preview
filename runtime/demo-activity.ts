interface Interaction {isTrusted:boolean}
export interface ActivityTarget {
  visibilityState:string;
  addEventListener(name:string,handler:(event:Interaction)=>void,options?:{passive:boolean}):void;
  removeEventListener(name:string,handler:(event:Interaction)=>void):void;
}
export function trackDemoActivity(target:ActivityTarget,send:()=>Promise<unknown>,now:()=>number=()=>Date.now()):()=>void {
  let lastSent=-Infinity,inFlight=false;
  const onInteraction=(event:Interaction)=>{
    if(!event.isTrusted||target.visibilityState!=='visible'||inFlight||now()-lastSent<15000)return;
    inFlight=true;lastSent=now();
    Promise.resolve().then(send).catch(()=>{lastSent=-Infinity;}).finally(()=>{inFlight=false;});
  };
  const events=['keydown','pointerdown','pointermove','touchstart','wheel'];
  for(const name of events)target.addEventListener(name,onInteraction,{passive:true});
  return ()=>{for(const name of events)target.removeEventListener(name,onInteraction);};
}
