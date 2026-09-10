// No operational data is cached on the device. Push works independently of an open tab.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let payload={};try{payload=event.data?.json()||{};}catch{}
 const title=typeof payload.title==='string'?payload.title.slice(0,100):'S&S Dispatch';
 const body=typeof payload.body==='string'?payload.body.slice(0,250):'Open the app to review dispatch alerts.';
 let path='/?view=dashboard';try{const u=new URL(payload.url||path,self.location.origin);if(u.origin===self.location.origin)path=u.pathname+u.search;}catch{}
 event.waitUntil(self.registration.showNotification(title,{body,tag:typeof payload.tag==='string'?payload.tag.slice(0,80):'ss-dispatch',icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',data:{url:path}}));
});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const url=new URL(event.notification.data?.url||'/',self.location.origin);if(url.origin!==self.location.origin)return;const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of windows)if(new URL(client.url).origin===url.origin){await client.navigate(url.href);return client.focus();}return self.clients.openWindow(url.href);})());});
