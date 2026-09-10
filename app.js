const STORAGE_KEY = "propertygps-v1";
let rawData = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
let data = rawData || {name:"My Property", waypoints:[], boundaries:[]};
if(!Array.isArray(data.waypoints)) data.waypoints=[];
if(!Array.isArray(data.boundaries)){
  data.boundaries=[];
  if(Array.isArray(rawData?.boundary) && rawData.boundary.length){
    data.boundaries.push({id:crypto.randomUUID(),name:rawData.boundaryName||"Boundary",points:rawData.boundary});
  }
}

let currentPosition=null, userMarker=null, accuracyCircle=null, headingMarker=null, followUser=false;
let boundaryLayers=[],editingBoundary=[];
let waypointMarkers=[],waypointAccuracyCircles=[];
let pendingWaypoint=null,boundaryMode=false,pendingBoundaryName="";
let gpsWatchId=null,latestRawPosition=null;
let currentHeading=null,headingSource="",headingPermissionAsked=false;
let navigationTarget=null,navigationLine=null,animationFrame=null,lastRenderedLL=null,targetRenderedLL=null;

const MAPTILER_KEY="BrG5QPYZu0l1ZQnYR2QJ";
const map=L.map("map",{zoomControl:false,preferCanvas:true,maxZoom:22}).setView([-37.8136,144.9631],10);
L.control.zoom({position:"bottomright"}).addTo(map);
const mapAttribution="&copy; MapTiler &copy; OpenStreetMap contributors";
const vicAerialAttribution='&copy; State of Victoria, Department of Transport and Planning — Vicmap Basemaps';
const topoLayer=L.tileLayer(`https://api.maptiler.com/maps/outdoor-v4/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,{tileSize:512,zoomOffset:-1,maxZoom:22,attribution:mapAttribution});
const satelliteLayer=L.tileLayer(`https://api.maptiler.com/maps/satellite-v4/{z}/{x}/{y}@2x.jpg?key=${MAPTILER_KEY}`,{tileSize:512,zoomOffset:-1,maxZoom:22,attribution:mapAttribution});
// Victorian Government Vicmap Aerial: higher-quality local aerial mosaic where available.
// This service is licensed; commercial use may require a Vicmap Basemaps licence.
const vicAerialLayer=L.tileLayer.wms("https://base.maps.vic.gov.au/service",{
  layers:"AERIAL_VG2020",format:"image/jpeg",transparent:false,version:"1.3.0",
  crs:L.CRS.EPSG3857,opacity:1,maxZoom:22,attribution:vicAerialAttribution
});
topoLayer.addTo(map);
let mapMode="topo";
const mapModes=["topo","satellite","vicAerial"];
const mapLabels={topo:"🗻 TOPO",satellite:"🛰️ SATELLITE",vicAerial:"🇦🇺 VIC AERIAL"};
const $=id=>document.getElementById(id);
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(data));updateStats()}
function updateStats(){$('waypointCount').textContent=data.waypoints.length;const area=data.boundaries.reduce((s,b)=>s+polygonAreaM2(b.points),0),perimeter=data.boundaries.reduce((s,b)=>s+polygonPerimeterM(b.points),0);$('boundaryArea').textContent=`${(area/10000).toFixed(2)} ha`;$('boundaryPerimeter').textContent=`${(perimeter/1000).toFixed(2)} km`;const countEl=$('boundaryCount');if(countEl)countEl.textContent=data.boundaries.length}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function setGPSStatus(t){$('status').textContent=t}
function updateGPSDisplay(pos){}
function smoothMoveMarker(marker,from,to,duration=700){if(!from){marker.setLatLng(to);return}const start=performance.now();const step=now=>{const t=Math.min(1,(now-start)/duration),e=t*(2-t);marker.setLatLng([from[0]+(to[0]-from[0])*e,from[1]+(to[1]-from[1])*e]);if(t<1)requestAnimationFrame(step)};requestAnimationFrame(step)}
function updateMapPosition(pos){const ll=[pos.latitude,pos.longitude];if(!userMarker){userMarker=L.circleMarker(ll,{radius:8,color:"#fff",weight:3,fillColor:"#3b82f6",fillOpacity:1}).addTo(map);lastRenderedLL=ll}else{smoothMoveMarker(userMarker,lastRenderedLL,ll,700);lastRenderedLL=ll}if(!accuracyCircle)accuracyCircle=L.circle(ll,{radius:pos.accuracy,color:"#3b82f6",weight:1,fillOpacity:.08}).addTo(map);else smoothMoveMarker(accuracyCircle,lastRenderedLL,ll,700),accuracyCircle.setRadius(pos.accuracy);updateHeadingMarker(ll)}
function updateHeadingMarker(ll){if(currentHeading===null)return;const html=`<div class="headingArrow" style="transform:rotate(${currentHeading}deg)"></div>`;const icon=L.divIcon({className:"headingMarker",html,iconSize:[44,44],iconAnchor:[22,22]});if(!headingMarker)headingMarker=L.marker(ll,{icon,interactive:false,zIndexOffset:1000}).addTo(map);else{headingMarker.setLatLng(ll);headingMarker.setIcon(icon)}}
function handleGPSPosition(pos){latestRawPosition=pos.coords;currentPosition=pos.coords;updateMapPosition(pos.coords);if(followUser)map.setView([pos.coords.latitude,pos.coords.longitude],map.getZoom(),{animate:false});const a=Number(pos.coords.accuracy)||9999;setGPSStatus(`GPS ±${Math.round(a)} m`);updateGPSDisplay(pos.coords);updateNavigation()}
function startGPS(){if(!navigator.geolocation){setGPSStatus("GPS unavailable");return}if(gpsWatchId!==null)navigator.geolocation.clearWatch(gpsWatchId);gpsWatchId=navigator.geolocation.watchPosition(handleGPSPosition,err=>{setGPSStatus(err.code===1?"Location permission denied":"Waiting for GPS…")},{enableHighAccuracy:true,maximumAge:0,timeout:10000})}
startGPS();
function centreOnUser(){if(!currentPosition){alert("Waiting for a GPS position.");return}followUser=true;map.setView([currentPosition.latitude,currentPosition.longitude],Math.max(map.getZoom(),17),{animate:true});$('hint').textContent="Map following your GPS position. Drag the map to stop following."}
$('locateBtn').onclick=centreOnUser;
map.on('dragstart',()=>{if(followUser){followUser=false;$('hint').textContent="Map follow stopped. Press the GPS locator to follow again."}});


async function requestCompass(){
  if(headingPermissionAsked)return;
  if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){
    try{const p=await DeviceOrientationEvent.requestPermission();if(p!=="granted"){headingPermissionAsked=true;$('hint').textContent="Compass permission is required for live heading.";return}}catch(e){return}
  }
  window.addEventListener("deviceorientationabsolute",handleOrientation,true);
  window.addEventListener("deviceorientation",handleOrientation,true);
  headingPermissionAsked=true;
  $('hint').textContent="Compass active. Keep the phone upright for the most reliable heading.";
}
function handleOrientation(e){let h=null;if(typeof e.webkitCompassHeading==="number"&&e.webkitCompassHeading>=0)h=e.webkitCompassHeading;else if(typeof e.alpha==="number")h=(360-e.alpha)%360;if(h===null)return;currentHeading=h;headingSource=e.webkitCompassHeading!==undefined?"compass":"device orientation";if(currentPosition)updateHeadingMarker([currentPosition.latitude,currentPosition.longitude]);updateNavigation()}
// Compass is always enabled. iOS requires permission from a user gesture, so the first
// interaction with the app requests it automatically; there is no on/off control.
requestCompass().catch(()=>{});
document.addEventListener("click",()=>{if(!headingPermissionAsked)requestCompass().catch(()=>{})},{once:true});

$('mapTypeBtn').onclick=()=>{
  const i=mapModes.indexOf(mapMode);
  const next=mapModes[(i+1)%mapModes.length];
  [topoLayer,satelliteLayer,vicAerialLayer].forEach(l=>{if(map.hasLayer(l))map.removeLayer(l)});
  ({topo:topoLayer,satellite:satelliteLayer,vicAerial:vicAerialLayer}[next]).addTo(map);
  mapMode=next;
  $('mapTypeBtn').textContent=mapLabels[next];
};

const OFFLINE_CACHE="propertygps-map-tiles-v2";
function tileXY(lat,lng,z){const n=Math.pow(2,z),x=Math.floor((lng+180)/360*n),latRad=lat*Math.PI/180,y=Math.floor((1-Math.asinh(Math.tan(latRad))/Math.PI)/2*n);return{x,y}}
function tileUrl(layer,z,x,y){return layer==="topo"?`https://api.maptiler.com/maps/outdoor-v4/${z}/${x}/${y}.png?key=${MAPTILER_KEY}`:`https://api.maptiler.com/maps/satellite-v4/${z}/${x}/${y}@2x.jpg?key=${MAPTILER_KEY}`}
async function saveOfflineArea(){
 const bounds=map.getBounds(), centerZoom=Math.round(map.getZoom()), minZ=Math.max(10,centerZoom-2), maxZ=Math.min(18,centerZoom+2), urls=[];
 for(const layer of ["topo","satellite"]) for(let z=minZ;z<=maxZ;z++){const nw=tileXY(bounds.getNorth(),bounds.getWest(),z),se=tileXY(bounds.getSouth(),bounds.getEast(),z),n=Math.pow(2,z);for(let x=nw.x;x<=se.x;x++)for(let y=nw.y;y<=se.y;y++)urls.push(tileUrl(layer,z,x,y));}
 if(urls.length>700){alert(`That area is too large to download at these zoom levels (${urls.length} tiles). Zoom in closer and try again.`);return}
 const cache=await caches.open(OFFLINE_CACHE);let done=0,failed=0;$('offlineBtn').disabled=true;
 for(const url of urls){try{const res=await fetch(url,{mode:"cors",cache:"force-cache"});if(res.ok)await cache.put(url,res.clone());else failed++}catch(e){failed++}done++;$('offlineBtn').textContent=`⬇ ${Math.round(done/urls.length*100)}%`}
 $('offlineBtn').disabled=false;$('offlineBtn').textContent="⬇ SAVE AREA OFFLINE";$('hint').textContent=failed?`Offline area saved with ${failed} unavailable tiles.`:"Topo + satellite area saved for offline use.";
}
$('offlineBtn').onclick=saveOfflineArea;

function captureWaypoint(){
  if(!currentPosition){alert("Waiting for GPS. Make sure Location Services and Precise Location are enabled.");return}
  const accuracy=Math.max(1,Number(currentPosition.accuracy)||9999);
  const waypointNumber=data.waypoints.length+1;
  data.waypoints.push({
    id:crypto.randomUUID(),
    name:`Waypoint ${waypointNumber}`,
    lat:Number(currentPosition.latitude),
    lng:Number(currentPosition.longitude),
    accuracy,
    bestAccuracy:accuracy,
    sampleCount:1,
    created:new Date().toISOString()
  });
  save();
  renderWaypoints();
  $('hint').textContent=`Waypoint placed — ±${Math.round(accuracy)} m.`;
}
$('markBtn').onclick=captureWaypoint;

$('removeNearestBtn').onclick=()=>{if(!currentPosition){alert("Waiting for a GPS position.");return}if(!data.waypoints.length){alert("There are no waypoints to remove.");return}let idx=-1,dmin=Infinity;data.waypoints.forEach((w,i)=>{const d=dist({lat:currentPosition.latitude,lng:currentPosition.longitude},{lat:w.lat,lng:w.lng});if(d<dmin){dmin=d;idx=i}});if(idx<0)return;const removed=data.waypoints.splice(idx,1)[0];if(navigationTarget&&navigationTarget.id===removed.id)stopNavigation();save();renderWaypoints();$('hint').textContent=`Removed “${removed.name}” — ${Math.round(dmin)} m from your GPS position.`};
$('navigateNearestBtn').onclick=()=>{
  if(!currentPosition){alert("Waiting for a GPS position.");return}
  if(!data.waypoints.length){alert("There are no waypoints.");return}
  let nearest=null,dmin=Infinity;
  data.waypoints.forEach(w=>{const d=dist({lat:currentPosition.latitude,lng:currentPosition.longitude},{lat:w.lat,lng:w.lng});if(d<dmin){dmin=d;nearest=w}});
  if(nearest) startNavigation(nearest.id);
};

function renderWaypoints(){
  waypointMarkers.forEach(m=>map.removeLayer(m));
  waypointMarkers=[];
  waypointAccuracyCircles.forEach(m=>map.removeLayer(m));
  waypointAccuracyCircles=[];
  data.waypoints.forEach(w=>{
    const accuracy=Math.max(1,Number(w.accuracy)||0);
    const accuracyCircle=L.circle([w.lat,w.lng], {radius:accuracy,color:"#2563eb",weight:1.5,fillColor:"#3b82f6",fillOpacity:.05,interactive:false}).addTo(map);
    waypointAccuracyCircles.push(accuracyCircle);
    const icon=L.divIcon({className:"waypointDragHandle",html:"<span></span>",iconSize:[22,22],iconAnchor:[11,11]});
    const m=L.marker([w.lat,w.lng],{icon,draggable:true,zIndexOffset:900}).addTo(map);
    m.bindTooltip("Hold and drag to move",{direction:"top",opacity:.9});
    m.bindPopup(`<b>${esc(w.name)}</b><br><span class="waypointCoords">${w.lat.toFixed(6)}, ${w.lng.toFixed(6)}</span><br>Accuracy ±${Math.round(accuracy)} m<button class="navPopupBtn" data-nav-id="${esc(w.id)}">🧭 NAVIGATE HERE</button>`);
    m.on('popupopen',e=>{const btn=e.popup.getElement().querySelector('.navPopupBtn');if(btn)btn.onclick=()=>startNavigation(w.id)});
    m.on('drag',e=>{
      const ll=e.target.getLatLng();
      w.lat=ll.lat; w.lng=ll.lng;
      accuracyCircle.setLatLng(ll);
      if(navigationTarget&&navigationTarget.id===w.id){navigationTarget=w;updateNavigation()}
    });
    m.on('dragstart',()=>{
      $('hint').textContent=`Moving “${w.name}” — drag to the new position.`;
    });
    m.on('dragend',()=>{
      save();
      const ll=m.getLatLng();
      m.setPopupContent(`<b>${esc(w.name)}</b><br><span class="waypointCoords">${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}</span><br>Accuracy ±${Math.round(accuracy)} m<button class="navPopupBtn" data-nav-id="${esc(w.id)}">🧭 NAVIGATE HERE</button>`);
      $('hint').textContent=`Waypoint “${w.name}” moved and saved.`;
    });
    waypointMarkers.push(m);
  });
}

function distancePointToSegmentMeters(p,a,b){
  const latScale=111320,lonScale=111320*Math.cos(p.lat*Math.PI/180);
  const px=p.lng*lonScale,py=p.lat*latScale,ax=a.lng*lonScale,ay=a.lat*latScale,bx=b.lng*lonScale,by=b.lat*latScale;
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  let t=den?((px-ax)*dx+(py-ay)*dy)/den:0;t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}
function distancePointToBoundary(lat,lng,points){
  if(!points?.length)return Infinity;
  if(points.length===1)return dist({lat,lng},points[0]);
  let best=Infinity;const p={lat,lng};
  for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];best=Math.min(best,distancePointToSegmentMeters(p,a,b))}
  return best;
}
function removeBoundaryLayers(){
  boundaryLayers.forEach(group=>{
    group.markers.forEach(m=>map.removeLayer(m));
    if(group.line)map.removeLayer(group.line);
    if(group.polygon)map.removeLayer(group.polygon);
    if(group.label)map.removeLayer(group.label);
  });
  boundaryLayers=[];
}
function renderOneBoundary(boundary,index){
  const pts=boundary.points.map(p=>[p.lat,p.lng]);const group={markers:[],line:null,polygon:null,label:null};
  boundary.points.forEach((p,i)=>{
    const icon=L.divIcon({className:"boundaryDragHandle",html:"<span></span>",iconSize:[24,24],iconAnchor:[12,12]});
    const m=L.marker([p.lat,p.lng],{icon,draggable:true,zIndexOffset:800}).bindTooltip(`${esc(boundary.name)} — point ${i+1}`,{direction:"top"}).addTo(map);
    m.on('drag',e=>{const ll=e.target.getLatLng();boundary.points[i].lat=ll.lat;boundary.points[i].lng=ll.lng;renderBoundaries(false)});
    m.on('dragend',()=>{save();$('hint').textContent=`Boundary “${boundary.name}” point ${i+1} moved and saved.`});
    group.markers.push(m);
  });
  if(pts.length>=2)group.line=L.polyline(pts,{color:"#2563eb",weight:5,dashArray:"8 6",bubblingMouseEvents:false}).addTo(map);
  if(pts.length>=3)group.polygon=L.polygon(pts,{color:"#2563eb",weight:2,fillColor:"#3b82f6",fillOpacity:.15,interactive:false}).addTo(map);
  if(boundary.name&&pts.length>=2){
    let edge=0,maxLen=-1;
    for(let i=0;i<pts.length;i++){const len=dist(boundary.points[i],boundary.points[(i+1)%pts.length]);if(len>maxLen){maxLen=len;edge=i}}
    const a=pts[edge],b=pts[(edge+1)%pts.length],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    group.label=L.marker(mid,{icon:L.divIcon({className:"",html:`<div class="boundaryEdgeLabel">${esc(boundary.name)}</div>`,iconSize:null,iconAnchor:[0,0]}),interactive:false}).addTo(map);
  }
  boundaryLayers.push(group);
}
function renderBoundaries(){
  removeBoundaryLayers();
  data.boundaries.forEach((b,i)=>renderOneBoundary(b,i));
  if(editingBoundary.length){
    const temp={name:"New boundary",points:editingBoundary};renderOneBoundary(temp,-1);
  }
  updateStats();
}

function startNavigation(id){const w=data.waypoints.find(x=>x.id===id);if(!w)return;navigationTarget=w;$('navTarget').textContent=w.name; $('navigationPanel').classList.remove('hidden');if(navigationLine)map.removeLayer(navigationLine);navigationLine=L.polyline([], {color:"#f59e0b",weight:5,dashArray:"10 8"}).addTo(map);$('hint').textContent=`Navigate to “${w.name}”. Use the compass heading and turn guidance.`;updateNavigation();map.closePopup()}
function stopNavigation(){navigationTarget=null;if(navigationLine){map.removeLayer(navigationLine);navigationLine=null}$('navigationPanel').classList.add('hidden');$('hint').textContent="GPS runs continuously. MARK HERE places a waypoint at your current GPS position."}
$('stopNavigationBtn').onclick=stopNavigation;
function bearingTo(a,b){const p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dl=(b.lng-a.lng)*Math.PI/180;const y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(Math.atan2(y,x)*180/Math.PI+360)%360}
function relativeTurn(target,heading){let d=((target-heading+540)%360)-180;return d}
function directionText(d){const ad=Math.abs(d);if(ad<5)return"STRAIGHT AHEAD";if(ad<15)return`${Math.round(ad)}° ${d>0?"RIGHT":"LEFT"}`;return`${Math.round(ad)}° ${d>0?"RIGHT":"LEFT"}`}
function updateNavigation(){if(!navigationTarget||!currentPosition)return;const a={lat:currentPosition.latitude,lng:currentPosition.longitude},b={lat:navigationTarget.lat,lng:navigationTarget.lng},distance=dist(a,b),bearing=bearingTo(a,b);$('navDistance').textContent=distance<1000?`${Math.round(distance)} m`:`${(distance/1000).toFixed(2)} km`;$('navBearing').textContent=`${Math.round(bearing)}°`;if(currentHeading===null)$('navDirection').textContent="Turn on COMPASS";else $('navDirection').textContent=directionText(relativeTurn(bearing,currentHeading));if(navigationLine)navigationLine.setLatLngs([[a.lat,a.lng],[b.lat,b.lng]])}

function polygonAreaM2(points){if(points.length<3)return 0;const R=6378137,lat0=points.reduce((s,p)=>s+p.lat,0)/points.length*Math.PI/180,xy=points.map(p=>[R*p.lng*Math.PI/180*Math.cos(lat0),R*p.lat*Math.PI/180]);let a=0;for(let i=0;i<xy.length;i++){const j=(i+1)%xy.length;a+=xy[i][0]*xy[j][1]-xy[j][0]*xy[i][1]}return Math.abs(a/2)}
function dist(a,b){const R=6371008.8,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dp=(b.lat-a.lat)*Math.PI/180,dl=(b.lng-a.lng)*Math.PI/180,x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function polygonPerimeterM(points){if(points.length<2)return 0;let s=0;for(let i=0;i<points.length;i++)s+=dist(points[i],points[(i+1)%points.length]);return s}
updateStats();renderWaypoints();renderBoundaries();
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
