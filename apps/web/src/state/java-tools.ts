import type { JavaLocation } from '@open-design/contracts';
const locations=new Map<string,JavaLocation>();
export function rememberJavaLocation(projectId:string,location:JavaLocation){
  const key=JSON.stringify([projectId,location.path]);locations.delete(key);locations.set(key,location);
  while(locations.size>32)locations.delete(locations.keys().next().value!);
  window.dispatchEvent(new CustomEvent('monofield:java-location',{detail:{projectId,location}}));
}
export function takeJavaLocation(projectId:string,path:string){const key=JSON.stringify([projectId,path]);const result=locations.get(key);locations.delete(key);return result;}
