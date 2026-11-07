import { trackDemoActivity } from './demo-activity.js';
trackDemoActivity(document,async()=>{
  const response=await fetch('/__demo/activity',{method:'POST',headers:{'X-Demo-Activity':'1'}});
  if(!response.ok)throw new Error('Activity rejected');
});
