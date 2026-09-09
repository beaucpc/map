const STORAGE_KEY = "propertygps-v1";
let data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {
  name:"My Property", waypoints:[], boundary:[]
};
let currentPosition = null;
let userMarker = null;
let accuracyCircle = null;
let boundaryLine = null;
let boundaryPolygon = null;
let boundaryMarkers = [];
let waypointMarkers = [];
let pendingWaypoint = null;
let boundaryMode = false;

const map = L.map("map", { zoomControl:false, preferCanvas:true }).setView([-37.8136,144.9631], 10);
L.control.zoom({position:"bottomright"}).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const $ = id => document.getElementById(id);

function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); updateStats(); }
function updateStats(){
  $("propertyName").value = data.name;
  $("waypointCount").textContent = data.waypoints.length;
  const area = polygonAreaM2(data.boundary);
  const perimeter = polygonPerimeterM(data.boundary);
  $("boundaryArea").textContent = `${(area/10000).toFixed(2)} ha`;
  $("boundaryPerimeter").textContent = `${(perimeter/1000).toFixed(2)} km`;
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

function startGPS(){
  if(!navigator.geolocation){
    $("status").textContent="GPS unavailable";
    return;
  }
  navigator.geolocation.watchPosition(pos=>{
    currentPosition = pos.coords;
    $("status").textContent = `GPS ±${Math.round(pos.coords.accuracy)} m`;
    $("accuracy").textContent = `Accuracy: ±${Math.round(pos.coords.accuracy)} m`;
    const ll=[pos.coords.latitude,pos.coords.longitude];
    if(!userMarker){
      userMarker=L.circleMarker(ll,{radius:8,color:"#fff",weight:3,fillColor:"#3b82f6",fillOpacity:1}).addTo(map);
    }else userMarker.setLatLng(ll);
    if(!accuracyCircle){
      accuracyCircle=L.circle(ll,{radius:pos.coords.accuracy,color:"#3b82f6",weight:1,fillOpacity:.08}).addTo(map);
    }else{accuracyCircle.setLatLng(ll);accuracyCircle.setRadius(pos.coords.accuracy);}
  },err=>{
    $("status").textContent = err.code===1 ? "Location permission denied" : "Waiting for GPS…";
  },{enableHighAccuracy:true,maximumAge:2000,timeout:15000});
}
startGPS();

function centreOnUser(){
  if(!currentPosition){alert("Waiting for a GPS position.");return;}
  map.setView([currentPosition.latitude,currentPosition.longitude], Math.max(map.getZoom(),17));
}

$("locateBtn").onclick=centreOnUser;

$("markBtn").onclick=()=>{
  if(!currentPosition){alert("Waiting for a GPS position. Make sure Location Services are enabled.");return;}
  pendingWaypoint={lat:currentPosition.latitude,lng:currentPosition.longitude,accuracy:currentPosition.accuracy};
  $("waypointName").value="";
  $("waypointDialog").classList.remove("hidden");
  setTimeout(()=>$("waypointName").focus(),50);
};

$("cancelWaypoint").onclick=()=>{pendingWaypoint=null;$("waypointDialog").classList.add("hidden")};
$("saveWaypoint").onclick=()=>{
  if(!pendingWaypoint)return;
  data.waypoints.push({
    id:crypto.randomUUID(),name:$("waypointName").value.trim()||"Waypoint",
    lat:pendingWaypoint.lat,lng:pendingWaypoint.lng,
    accuracy:pendingWaypoint.accuracy,created:new Date().toISOString()
  });
  pendingWaypoint=null;$("waypointDialog").classList.add("hidden");save();renderWaypoints();
};

$("boundaryBtn").onclick=()=>{
  boundaryMode=!boundaryMode;
  $("boundaryBtn").textContent=boundaryMode?"✓ FINISH BOUNDARY":"⬡ BOUNDARY";
  $("hint").textContent=boundaryMode?"Tap the map to add boundary points. Tap FINISH when done.":"Tap MARK HERE to save your current GPS position.";
  map.getContainer().style.cursor=boundaryMode?"crosshair":"";
};

map.on("click",e=>{
  if(!boundaryMode)return;
  data.boundary.push({lat:e.latlng.lat,lng:e.latlng.lng});
  save();renderBoundary();
});

$("clearBoundaryBtn").onclick=()=>{
  if(confirm("Clear the entire property boundary?")){
    data.boundary=[];save();renderBoundary();
  }
};
$("saveNameBtn").onclick=()=>{data.name=$("propertyName").value.trim()||"My Property";save()};

function renderWaypoints(){
  waypointMarkers.forEach(m=>map.removeLayer(m)); waypointMarkers=[];
  data.waypoints.forEach(w=>{
    const m=L.marker([w.lat,w.lng]).addTo(map);
    m.bindPopup(`<b>${esc(w.name)}</b><br>${w.lat.toFixed(6)}, ${w.lng.toFixed(6)}<br>Accuracy ±${Math.round(w.accuracy||0)} m`);
    waypointMarkers.push(m);
  });
}
function renderBoundary(){
  boundaryMarkers.forEach(m=>map.removeLayer(m)); boundaryMarkers=[];
  if(boundaryLine)map.removeLayer(boundaryLine);
  if(boundaryPolygon)map.removeLayer(boundaryPolygon);
  const pts=data.boundary.map(p=>[p.lat,p.lng]);
  data.boundary.forEach((p,i)=>{
    const m=L.circleMarker([p.lat,p.lng],{radius:6,color:"#2563eb",fillColor:"#60a5fa",fillOpacity:1});
    m.bindTooltip(`Boundary ${i+1}`,{direction:"top"});
    m.addTo(map);boundaryMarkers.push(m);
  });
  if(pts.length>=2){
    boundaryLine=L.polyline(pts,{color:"#2563eb",weight:4,dashArray:"8 6"}).addTo(map);
  }
  if(pts.length>=3){
    boundaryPolygon=L.polygon(pts,{color:"#2563eb",weight:2,fillColor:"#3b82f6",fillOpacity:.15}).addTo(map);
  }
  updateStats();
}
function polygonAreaM2(points){
  if(points.length<3)return 0;
  const R=6378137, lat0=points.reduce((s,p)=>s+p.lat,0)/points.length*Math.PI/180;
  const xy=points.map(p=>[R*p.lng*Math.PI/180*Math.cos(lat0),R*p.lat*Math.PI/180]);
  let a=0;for(let i=0;i<xy.length;i++){let j=(i+1)%xy.length;a+=xy[i][0]*xy[j][1]-xy[j][0]*xy[i][1]}
  return Math.abs(a/2);
}
function dist(a,b){
  const R=6371008.8, p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dp=(b.lat-a.lat)*Math.PI/180,dl=(b.lng-a.lng)*Math.PI/180;
  const x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function polygonPerimeterM(points){
  if(points.length<2)return 0;let s=0;
  for(let i=0;i<points.length;i++)s+=dist(points[i],points[(i+1)%points.length]);
  return s;
}

$("exportBtn").onclick=()=>{
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);
  a.download=(data.name||"property").replace(/[^a-z0-9_-]+/gi,"_")+".json";a.click();
  URL.revokeObjectURL(a.href);
};
$("importInput").onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{try{const imported=JSON.parse(r.result);if(!imported.waypoints||!imported.boundary)throw 0;data=imported;save();renderWaypoints();renderBoundary()}catch{alert("That file is not a valid PropertyGPS file.")}};
  r.readAsText(f);e.target.value="";
};

updateStats();renderWaypoints();renderBoundary();
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
