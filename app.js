const STORAGE_KEY = "propertygps-v1";
let data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {name:"My Property", waypoints:[], boundary:[], boundaryName:""};
if(!Array.isArray(data.waypoints)) data.waypoints=[];
if(!Array.isArray(data.boundary)) data.boundary=[];

let currentPosition=null, userMarker=null, accuracyCircle=null, headingMarker=null;
let boundaryLine=null,boundaryPolygon=null,boundaryMarkers=[],boundaryEdgeLabels=[],waypointMarkers=[],waypointAccuracyCircles=[];
let pendingWaypoint=null,boundaryMode=false,pendingBoundaryName="";
let gpsWatchId=null,latestRawPosition=null,gpsSamples=[],captureTimer=null,captureActive=false;
let currentHeading=null,headingSource="",headingPermissionAsked=false;
let navigationTarget=null,navigationLine=null,animationFrame=null,lastRenderedLL=null,targetRenderedLL=null;
const CAPTURE_MS=3000, MAX_SAMPLE_AGE_MS=12000;

const MAPTILER_KEY="BrG5QPYZu0l1ZQnYR2QJ";
const map=L.map("map",{zoomControl:false,preferCanvas:true,maxZoom:22}).setView([-37.8136,144.9631],10);
L.control.zoom({position:"bottomright"}).addTo(map);
const mapAttribution="&copy; MapTiler &copy; OpenStreetMap contributors";
const topoLayer=L.tileLayer(`https://api.maptiler.com/maps/outdoor-v4/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,{tileSize:512,zoomOffset:-1,maxZoom:22,attribution:mapAttribution});
const satelliteLayer=L.tileLayer(`https://api.maptiler.com/tiles/satellite-v4/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`,{tileSize:512,zoomOffset:-1,maxZoom:22,attribution:mapAttribution});
topoLayer.addTo(map);
let mapMode="topo";
const mapModes=["topo","satellite"];
const mapLabels={topo:"🗻 TOPO",satellite:"🛰️ SATELLITE"};
const $=id=>document.getElementById(id);
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(data));updateStats()}
function updateStats(){$("propertyName").value=data.name;$('waypointCount').textContent=data.waypoints.length;const area=polygonAreaM2(data.boundary),perimeter=polygonPerimeterM(data.boundary);$('boundaryArea').textContent=`${(area/10000).toFixed(2)} ha`;$('boundaryPerimeter').textContent=`${(perimeter/1000).toFixed(2)} km`}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function setGPSStatus(t){$('status').textContent=t}
function getBestAccuracy(){return gpsSamples.length ? Math.min(...gpsSamples.map(p=>Number(p.accuracy)||9999)) : (latestRawPosition?.accuracy || 9999)}
function updateGPSDisplay(pos){const a=Number(pos.accuracy)||9999;$('accuracy').textContent=`Accuracy: ±${Math.round(a)} m`;if(captureActive)$('hint').textContent=`Collecting GPS fixes… ${gpsSamples.length} samples • best ±${Math.round(getBestAccuracy())} m`}
function addGPSSample(coords){const now=Date.now();if(coords.timestamp&&now-coords.timestamp>MAX_SAMPLE_AGE_MS)return;const p={latitude:Number(coords.latitude),longitude:Number(coords.longitude),accuracy:Number(coords.accuracy)||9999,timestamp:now};if(!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude))return;gpsSamples.push(p);if(gpsSamples.length>40)gpsSamples.shift();updateGPSDisplay(p)}
function smoothMoveMarker(marker,from,to,duration=700){if(!from){marker.setLatLng(to);return}const start=performance.now();const step=now=>{const t=Math.min(1,(now-start)/duration),e=t*(2-t);marker.setLatLng([from[0]+(to[0]-from[0])*e,from[1]+(to[1]-from[1])*e]);if(t<1)requestAnimationFrame(step)};requestAnimationFrame(step)}
function updateMapPosition(pos){const ll=[pos.latitude,pos.longitude];if(!userMarker){userMarker=L.circleMarker(ll,{radius:8,color:"#fff",weight:3,fillColor:"#3b82f6",fillOpacity:1}).addTo(map);lastRenderedLL=ll}else{smoothMoveMarker(userMarker,lastRenderedLL,ll,700);lastRenderedLL=ll}if(!accuracyCircle)accuracyCircle=L.circle(ll,{radius:pos.accuracy,color:"#3b82f6",weight:1,fillOpacity:.08}).addTo(map);else smoothMoveMarker(accuracyCircle,lastRenderedLL,ll,700),accuracyCircle.setRadius(pos.accuracy);updateHeadingMarker(ll)}
function updateHeadingMarker(ll){if(currentHeading===null)return;const html=`<div class="headingArrow" style="transform:rotate(${currentHeading}deg)"></div>`;const icon=L.divIcon({className:"headingMarker",html,iconSize:[44,44],iconAnchor:[22,22]});if(!headingMarker)headingMarker=L.marker(ll,{icon,interactive:false,zIndexOffset:1000}).addTo(map);else{headingMarker.setLatLng(ll);headingMarker.setIcon(icon)}}
function handleGPSPosition(pos){latestRawPosition=pos.coords;currentPosition=pos.coords;updateMapPosition(pos.coords);const a=Number(pos.coords.accuracy)||9999;setGPSStatus(`GPS ±${Math.round(a)} m`);updateGPSDisplay(pos.coords);addGPSSample(pos.coords);updateNavigation()}
function startGPS(){if(!navigator.geolocation){setGPSStatus("GPS unavailable");return}if(gpsWatchId!==null)navigator.geolocation.clearWatch(gpsWatchId);gpsWatchId=navigator.geolocation.watchPosition(handleGPSPosition,err=>{setGPSStatus(err.code===1?"Location permission denied":"Waiting for GPS…")},{enableHighAccuracy:true,maximumAge:0,timeout:10000})}
startGPS();
function centreOnUser(){if(!currentPosition){alert("Waiting for a GPS position.");return}map.setView([currentPosition.latitude,currentPosition.longitude],Math.max(map.getZoom(),17))}$('locateBtn').onclick=centreOnUser;

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
  [topoLayer,satelliteLayer].forEach(l=>{if(map.hasLayer(l))map.removeLayer(l)});
  ({topo:topoLayer,satellite:satelliteLayer}[next]).addTo(map);
  mapMode=next;
  $('mapTypeBtn').textContent=mapLabels[next];
};

const OFFLINE_CACHE="propertygps-map-tiles-v1";
function tileXY(lat,lng,z){const n=Math.pow(2,z),x=Math.floor((lng+180)/360*n),latRad=lat*Math.PI/180,y=Math.floor((1-Math.asinh(Math.tan(latRad))/Math.PI)/2*n);return{x,y}}
function tileUrl(layer,z,x,y){return layer==="topo"?`https://api.maptiler.com/maps/outdoor-v4/${z}/${x}/${y}.png?key=${MAPTILER_KEY}`:`https://api.maptiler.com/tiles/satellite-v4/${z}/${x}/${y}.jpg?key=${MAPTILER_KEY}`}
async function saveOfflineArea(){
 const bounds=map.getBounds(), centerZoom=Math.round(map.getZoom()), minZ=Math.max(10,centerZoom-2), maxZ=Math.min(18,centerZoom+2), urls=[];
 for(const layer of ["topo","satellite"]) for(let z=minZ;z<=maxZ;z++){const nw=tileXY(bounds.getNorth(),bounds.getWest(),z),se=tileXY(bounds.getSouth(),bounds.getEast(),z),n=Math.pow(2,z);for(let x=nw.x;x<=se.x;x++)for(let y=nw.y;y<=se.y;y++)urls.push(tileUrl(layer,z,x,y));}
 if(urls.length>700){alert(`That area is too large to download at these zoom levels (${urls.length} tiles). Zoom in closer and try again.`);return}
 const cache=await caches.open(OFFLINE_CACHE);let done=0,failed=0;$('offlineBtn').disabled=true;
 for(const url of urls){try{const res=await fetch(url,{mode:"cors",cache:"force-cache"});if(res.ok)await cache.put(url,res.clone());else failed++}catch(e){failed++}done++;$('offlineBtn').textContent=`⬇ ${Math.round(done/urls.length*100)}%`}
 $('offlineBtn').disabled=false;$('offlineBtn').textContent="⬇ SAVE AREA OFFLINE";$('hint').textContent=failed?`Offline area saved with ${failed} unavailable tiles.`:"Topo + satellite area saved for offline use.";
}
$('offlineBtn').onclick=saveOfflineArea;

function averageGPS(samples){if(!samples.length)return null;let ws=0,lat=0,lng=0;samples.forEach(p=>{const a=Math.max(1,p.accuracy||9999),w=1/(a*a);ws+=w;lat+=p.latitude*w;lng+=p.longitude*w});lat/=ws;lng/=ws;let sq=0;samples.forEach(p=>{const d=dist({lat,lng},{lat:p.latitude,lng:p.longitude});const w=1/(Math.max(1,p.accuracy||9999)**2);sq+=d*d*w});const spread=Math.sqrt(sq/ws),bestAccuracy=Math.min(...samples.map(p=>p.accuracy||9999));return{lat,lng,accuracy:Math.max(bestAccuracy,spread),bestAccuracy,spread}}
function finishWaypointCapture(){captureActive=false;if(captureTimer){clearTimeout(captureTimer);captureTimer=null}const recent=gpsSamples.filter(p=>Date.now()-p.timestamp<=MAX_SAMPLE_AGE_MS);if(!recent.length){alert("No usable GPS fixes were received.");return}const good=recent.filter(p=>p.accuracy<=30),samples=good.length>=2?good:recent.slice(-15),r=averageGPS(samples);if(!r)return;pendingWaypoint={lat:r.lat,lng:r.lng,accuracy:r.accuracy,bestAccuracy:r.bestAccuracy,sampleCount:samples.length};$('waypointName').value="";$('captureInfo').textContent=`Averaged ${samples.length} fixes. Best ±${Math.round(r.bestAccuracy)} m; estimated spread ±${Math.round(r.spread)} m.`;$('waypointDialog').classList.remove('hidden');$('hint').textContent="GPS capture complete. Name and save the waypoint.";setTimeout(()=>$('waypointName').focus(),50)}
function captureWaypoint(){if(!currentPosition){alert("Waiting for GPS. Make sure Location Services and Precise Location are enabled.");return}if(captureActive)return;captureActive=true;gpsSamples=[];$('waypointDialog').classList.add('hidden');$('hint').textContent="Collecting GPS fixes for 3 seconds…";setGPSStatus("GPS capture in progress…");addGPSSample(currentPosition);captureTimer=setTimeout(finishWaypointCapture,CAPTURE_MS)}
$('markBtn').onclick=captureWaypoint;
$('cancelWaypoint').onclick=()=>{pendingWaypoint=null;captureActive=false;if(captureTimer)clearTimeout(captureTimer);captureTimer=null;$('waypointDialog').classList.add('hidden');$('hint').textContent="Tap MARK HERE to save your current GPS position."};
$('saveWaypoint').onclick=()=>{if(!pendingWaypoint)return;data.waypoints.push({id:crypto.randomUUID(),name:$('waypointName').value.trim()||"Waypoint",lat:pendingWaypoint.lat,lng:pendingWaypoint.lng,accuracy:pendingWaypoint.accuracy,bestAccuracy:pendingWaypoint.bestAccuracy,sampleCount:pendingWaypoint.sampleCount,created:new Date().toISOString()});pendingWaypoint=null;$('waypointDialog').classList.add('hidden');save();renderWaypoints()};

$('boundaryBtn').onclick=()=>{if(boundaryMode){boundaryMode=false;$('boundaryBtn').textContent="⬡ BOUNDARY";map.getContainer().style.cursor="";if(data.boundary.length>=3){$('boundaryName').value=data.boundaryName||"";$('boundaryDialog').classList.remove('hidden');setTimeout(()=>$('boundaryName').focus(),50)}else{$('hint').textContent="Boundary needs at least 3 points."}}else{data.boundary=[];data.boundaryName="";boundaryMode=true;$('boundaryBtn').textContent="✓ FINISH BOUNDARY";$('hint').textContent="Tap the map to add boundary points. Tap FINISH when done.";map.getContainer().style.cursor="crosshair";renderBoundary()}};
map.on('click',e=>{if(!boundaryMode)return;data.boundary.push({lat:e.latlng.lat,lng:e.latlng.lng});renderBoundary()});
$('cancelBoundary').onclick=()=>{$('boundaryDialog').classList.add('hidden');$('hint').textContent="Boundary captured. You can rename it by finishing boundary again."};
$('saveBoundary').onclick=()=>{data.boundaryName=$('boundaryName').value.trim()||"Boundary";$('boundaryDialog').classList.add('hidden');save();renderBoundary();$('hint').textContent=`Boundary “${data.boundaryName}” saved.`};
$('clearBoundaryBtn').onclick=()=>{if(confirm("Clear the entire property boundary?")){data.boundary=[];data.boundaryName="";save();renderBoundary()}};

$('removeNearestBtn').onclick=()=>{if(!currentPosition){alert("Waiting for a GPS position.");return}if(!data.waypoints.length){alert("There are no waypoints to remove.");return}let idx=-1,dmin=Infinity;data.waypoints.forEach((w,i)=>{const d=dist({lat:currentPosition.latitude,lng:currentPosition.longitude},{lat:w.lat,lng:w.lng});if(d<dmin){dmin=d;idx=i}});if(idx<0)return;const removed=data.waypoints.splice(idx,1)[0];if(navigationTarget&&navigationTarget.id===removed.id)stopNavigation();save();renderWaypoints();$('hint').textContent=`Removed “${removed.name}” — ${Math.round(dmin)} m from your GPS position.`};
$('navigateNearestBtn').onclick=()=>{
  if(!currentPosition){alert("Waiting for a GPS position.");return}
  if(!data.waypoints.length){alert("There are no waypoints.");return}
  let nearest=null,dmin=Infinity;
  data.waypoints.forEach(w=>{const d=dist({lat:currentPosition.latitude,lng:currentPosition.longitude},{lat:w.lat,lng:w.lng});if(d<dmin){dmin=d;nearest=w}});
  if(nearest) startNavigation(nearest.id);
};
$('saveNameBtn').onclick=()=>{data.name=$('propertyName').value.trim()||"My Property";save()};

function renderWaypoints(){
  waypointMarkers.forEach(m=>map.removeLayer(m));
  waypointMarkers=[];
  waypointAccuracyCircles.forEach(m=>map.removeLayer(m));
  waypointAccuracyCircles=[];
  data.waypoints.forEach(w=>{
    const accuracy=Math.max(1,Number(w.accuracy)||0);
    const accuracyCircle=L.circle([w.lat,w.lng], {radius:accuracy,color:"#2563eb",weight:1.5,fillColor:"#3b82f6",fillOpacity:.05,interactive:false}).addTo(map);
    waypointAccuracyCircles.push(accuracyCircle);
    const m=L.circleMarker([w.lat,w.lng],{radius:5,color:"#fff",weight:2,fillColor:"#2563eb",fillOpacity:1}).addTo(map);
    m.bindPopup(`<b>${esc(w.name)}</b><br>${w.lat.toFixed(6)}, ${w.lng.toFixed(6)}<br>Accuracy ±${Math.round(accuracy)} m<button class="navPopupBtn" data-nav-id="${esc(w.id)}">🧭 NAVIGATE HERE</button>`);
    m.on('popupopen',e=>{const btn=e.popup.getElement().querySelector('.navPopupBtn');if(btn)btn.onclick=()=>startNavigation(w.id)});
    waypointMarkers.push(m);
  });
}

function boundaryGeometry(){
  const pts=data.boundary.map(p=>[p.lat,p.lng]);
  if(boundaryLine) boundaryLine.setLatLngs(pts);
  if(boundaryPolygon) boundaryPolygon.setLatLngs(pts);
  boundaryEdgeLabels.forEach(m=>map.removeLayer(m)); boundaryEdgeLabels=[];
  if(data.boundaryName&&pts.length>=2){
    let labelEdge=0,labelLength=-1;
    for(let i=0;i<pts.length;i++){
      const a=data.boundary[i],b=data.boundary[(i+1)%data.boundary.length],len=dist(a,b);
      if(len>labelLength){labelLength=len;labelEdge=i}
    }
    const a=pts[labelEdge],b=pts[(labelEdge+1)%pts.length],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    const label=L.marker(mid,{icon:L.divIcon({className:"",html:`<div class="boundaryEdgeLabel">${esc(data.boundaryName)}</div>`,iconSize:null,iconAnchor:[0,0]}),interactive:false}).addTo(map);
    boundaryEdgeLabels.push(label);
  }
  updateStats();
}
function renderBoundary(){
  boundaryMarkers.forEach(m=>map.removeLayer(m)); boundaryMarkers=[];
  boundaryEdgeLabels.forEach(m=>map.removeLayer(m)); boundaryEdgeLabels=[];
  if(boundaryLine)map.removeLayer(boundaryLine); boundaryLine=null;
  if(boundaryPolygon)map.removeLayer(boundaryPolygon); boundaryPolygon=null;
  const pts=data.boundary.map(p=>[p.lat,p.lng]);
  data.boundary.forEach((p,i)=>{
    const m=L.circleMarker([p.lat,p.lng],{radius:7,color:"#fff",weight:2,fillColor:"#2563eb",fillOpacity:1,draggable:true}).bindTooltip(`Boundary ${i+1} — drag to move`,{direction:"top"}).addTo(map);
    m.on('drag',e=>{
      const ll=e.target.getLatLng(); data.boundary[i].lat=ll.lat; data.boundary[i].lng=ll.lng;
      boundaryGeometry();
    });
    m.on('dragend',()=>{save();$('hint').textContent=`Boundary point ${i+1} moved and saved.`;});
    boundaryMarkers.push(m);
  });
  if(pts.length>=2){
    boundaryLine=L.polyline(pts,{color:"#2563eb",weight:5,dashArray:"8 6",bubblingMouseEvents:false}).addTo(map);
    boundaryLine.on('dblclick',e=>{
      const index=nearestBoundarySegmentIndex(e.latlng);
      data.boundary.splice(index+1,0,{lat:e.latlng.lat,lng:e.latlng.lng});
      save(); renderBoundary(); $('hint').textContent=`Added boundary point ${index+2}. Drag it to adjust the corner.`;
      L.DomEvent.stop(e.originalEvent);
    });
  }
  if(pts.length>=3) boundaryPolygon=L.polygon(pts,{color:"#2563eb",weight:2,fillColor:"#3b82f6",fillOpacity:.15,interactive:false}).addTo(map);
  boundaryGeometry();
}
function nearestBoundarySegmentIndex(ll){
  let best=0,bestD=Infinity;
  for(let i=0;i<data.boundary.length;i++){
    const a=data.boundary[i],b=data.boundary[(i+1)%data.boundary.length];
    const d=distancePointToSegment(ll,a,b);
    if(d<bestD){bestD=d;best=i;}
  }
  return best;
}
function distancePointToSegment(p,a,b){
  const latScale=111320, lonScale=111320*Math.cos(p.lat*Math.PI/180);
  const px= p.lng*lonScale, py=p.lat*latScale, ax=a.lng*lonScale, ay=a.lat*latScale, bx=b.lng*lonScale, by=b.lat*latScale;
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  let t=den?((px-ax)*dx+(py-ay)*dy)/den:0; t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}

function startNavigation(id){const w=data.waypoints.find(x=>x.id===id);if(!w)return;navigationTarget=w;$('navTarget').textContent=w.name; $('navigationPanel').classList.remove('hidden');if(navigationLine)map.removeLayer(navigationLine);navigationLine=L.polyline([], {color:"#f59e0b",weight:5,dashArray:"10 8"}).addTo(map);$('hint').textContent=`Navigate to “${w.name}”. Use the compass heading and turn guidance.`;updateNavigation();map.closePopup()}
function stopNavigation(){navigationTarget=null;if(navigationLine){map.removeLayer(navigationLine);navigationLine=null}$('navigationPanel').classList.add('hidden');$('hint').textContent="GPS runs continuously. MARK HERE averages fixes for 3 seconds for a more stable waypoint."}
$('stopNavigationBtn').onclick=stopNavigation;
function bearingTo(a,b){const p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dl=(b.lng-a.lng)*Math.PI/180;const y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(Math.atan2(y,x)*180/Math.PI+360)%360}
function relativeTurn(target,heading){let d=((target-heading+540)%360)-180;return d}
function directionText(d){const ad=Math.abs(d);if(ad<5)return"STRAIGHT AHEAD";if(ad<15)return`${Math.round(ad)}° ${d>0?"RIGHT":"LEFT"}`;return`${Math.round(ad)}° ${d>0?"RIGHT":"LEFT"}`}
function updateNavigation(){if(!navigationTarget||!currentPosition)return;const a={lat:currentPosition.latitude,lng:currentPosition.longitude},b={lat:navigationTarget.lat,lng:navigationTarget.lng},distance=dist(a,b),bearing=bearingTo(a,b);$('navDistance').textContent=distance<1000?`${Math.round(distance)} m`:`${(distance/1000).toFixed(2)} km`;$('navBearing').textContent=`${Math.round(bearing)}°`;if(currentHeading===null)$('navDirection').textContent="Turn on COMPASS";else $('navDirection').textContent=directionText(relativeTurn(bearing,currentHeading));if(navigationLine)navigationLine.setLatLngs([[a.lat,a.lng],[b.lat,b.lng]])}

function polygonAreaM2(points){if(points.length<3)return 0;const R=6378137,lat0=points.reduce((s,p)=>s+p.lat,0)/points.length*Math.PI/180,xy=points.map(p=>[R*p.lng*Math.PI/180*Math.cos(lat0),R*p.lat*Math.PI/180]);let a=0;for(let i=0;i<xy.length;i++){const j=(i+1)%xy.length;a+=xy[i][0]*xy[j][1]-xy[j][0]*xy[i][1]}return Math.abs(a/2)}
function dist(a,b){const R=6371008.8,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dp=(b.lat-a.lat)*Math.PI/180,dl=(b.lng-a.lng)*Math.PI/180,x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function polygonPerimeterM(points){if(points.length<2)return 0;let s=0;for(let i=0;i<points.length;i++)s+=dist(points[i],points[(i+1)%points.length]);return s}
updateStats();renderWaypoints();renderBoundary();
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
