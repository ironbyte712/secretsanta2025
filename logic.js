// full client-side logic with Firebase Realtime DB integration (compat)
//////////////////////////////////////////////////////////////
// Replace FIREBASE.firebaseConfig values with your project's
// config and ensure FIREBASE.ADMIN_UID matches the admin user UID
//////////////////////////////////////////////////////////////

// Storage keys
const KEY_PARTS = 'ss_participants';
const KEY_ASSIGN = 'ss_assignments'; // giver -> {receiver,wishlist,address,code}
const KEY_USED = 'ss_used'; // array of givers who already revealed
const KEY_ADMINPASS = 'ss_admin_pass';

// In-memory
let participants = loadJSON(KEY_PARTS) || []; // {name,wishlist,address}
let assignments = loadJSON(KEY_ASSIGN) || {}; // giver -> {receiver,wishlist,address,code}
let usedGivers = loadJSON(KEY_USED) || []; // array of names

// Utility
function saveJSON(key, obj){ localStorage.setItem(key, JSON.stringify(obj)); }
function loadJSON(key){ try { return JSON.parse(localStorage.getItem(key)); } catch(e){ return null; } }

// ---------------- Admin / local auth ----------------
function adminLogin(){
  // If Firebase signed-in as admin -> show console
  if(window.fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid === FIREBASE.ADMIN_UID){
    document.getElementById('adminPanel').style.display = 'block';
    refreshAdminList();
    return;
  }

  // fallback: local password prompt (existing behavior)
  const stored = localStorage.getItem(KEY_ADMINPASS) || 'admin123';
  const p = prompt("Enter admin password (or leave blank to sign-in with Firebase):");
  if(p === null) return;
  if(p === ''){
    const email = prompt('Admin email (Firebase):');
    if(!email) return;
    const pw = prompt('Admin password (Firebase):');
    if(!pw) return;
    signInAdminFirebase(email, pw).then(() => {
      if(fbAuth.currentUser && fbAuth.currentUser.uid === FIREBASE.ADMIN_UID){
        document.getElementById('adminPanel').style.display = 'block';
        refreshAdminList();
      }
    });
    return;
  }
  if(p === stored){
    document.getElementById('adminPanel').style.display = 'block';
    document.getElementById('adminPassHint').textContent = 'set';
    refreshAdminList();
    return;
  }
  alert("Wrong password.");
}
function setAdminPass(){
  const v = document.getElementById('adminPass').value;
  if(!v){ alert("Leave blank to keep existing password."); return; }
  localStorage.setItem(KEY_ADMINPASS, v);
  alert("Password saved.");
  document.getElementById('adminPass').value = '';
}

// ---------------- Excel parsing (SheetJS) ----------------
function parseExcel(){
  const f = document.getElementById('excelInput').files[0];
  if(!f){ alert("Choose an Excel/CSV file first."); return; }
  const reader = new FileReader();
  reader.onload = function(e){
    let data = e.target.result;
    let wb;
    try { wb = XLSX.read(data, {type: 'binary'}); } catch(err) { wb = XLSX.read(data, {type: 'string'}); }
    const first = wb.SheetNames[0];
    const ws = wb.Sheets[first];
    const rows = XLSX.utils.sheet_to_json(ws, {defval:''});
    const mapped = rows.map(r => {
      const lower = {};
      Object.keys(r).forEach(k => lower[k.trim().toLowerCase()] = r[k]);
      return {
        name: (lower['name'] || lower['full name'] || lower['participant'] || '').toString().trim(),
        wishlist: (lower['wishlist'] || lower['wish list'] || '').toString(),
        address: (lower['address'] || '').toString()
      };
    }).filter(x => x.name && x.name.trim());
    if(mapped.length === 0){ alert("No valid rows with a Name column found."); return; }
    mapped.forEach(p => {
      if(!participants.some(pp => pp.name === p.name)){
        participants.push({name: p.name, wishlist: p.wishlist, address: p.address});
      }
    });
    saveJSON(KEY_PARTS, participants);
    refreshAdminList();
    // try to save remote if admin signed in
    if(window.fbDB && window.fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid === FIREBASE.ADMIN_UID){
      saveParticipantsRemote().catch(()=>{/* ignore */});
    }
    alert("Loaded " + mapped.length + " participants.");
  };
  reader.readAsBinaryString(f);
}

// ---------------- single participant ----------------
function addSingleParticipant(){
  const n = document.getElementById('singleName').value.trim();
  if(!n){ alert("Enter a name."); return; }
  if(participants.some(p => p.name === n)){ alert("Name already exists."); return; }
  participants.push({name: n, wishlist: document.getElementById('singleWishlist').value.trim(), address: document.getElementById('singleAddress').value.trim()});
  saveJSON(KEY_PARTS, participants);
  document.getElementById('singleName').value='';
  document.getElementById('singleWishlist').value='';
  document.getElementById('singleAddress').value='';
  refreshAdminList();
  if(window.fbDB && window.fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid === FIREBASE.ADMIN_UID){
    saveParticipantsRemote().catch(()=>{/* ignore */});
  }
}

// ---------------- UI admin list (names only) ----------------
function refreshAdminList(){
  const el = document.getElementById('adminList');
  if(!el) return;
  if(participants.length === 0){ el.innerHTML = '<div class="hint">No participants loaded.</div>'; return; }
  let html = '<ul>';
  participants.forEach(p => { html += `<li>${escapeHtml(p.name)}</li>`; });
  html += '</ul>';
  el.innerHTML = html;
}

// ---------------- derangement & codes ----------------
function shuffleArray(a){ const arr = a.slice(); for(let i=arr.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [arr[i],arr[j]] = [arr[j],arr[i]] } return arr; }
function makeDerangement(names){
  if(names.length < 2) return null;
  let attempts = 0, receivers;
  do { receivers = shuffleArray(names); attempts++; if(attempts > 5000) return null; } while(names.some((n,i)=>n===receivers[i]));
  return receivers;
}
function genCode(len){
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = ''; const array = new Uint8Array(len); window.crypto.getRandomValues(array);
  for(let i=0;i<len;i++) s += chars[array[i] % chars.length];
  return s;
}

function generateAllAssignments(){
  if(participants.length < 2){ alert("Need at least 2 participants."); return; }
  const names = participants.map(p => p.name);
  const receivers = makeDerangement(names);
  if(!receivers){ alert("Could not generate assignments. Try again."); return; }
  assignments = {};
  for(let i=0;i<names.length;i++){
    const giver = names[i];
    const receiver = receivers[i];
    const rdata = participants.find(p => p.name === receiver);
    assignments[giver] = {
      receiver: receiver,
      wishlist: rdata ? rdata.wishlist : '',
      address: rdata ? rdata.address : '',
      code: genCode(8)
    };
  }
  saveJSON(KEY_ASSIGN, assignments);
  // reset used
  usedGivers = []; saveJSON(KEY_USED, usedGivers);
  // try saving remote assignments if admin signed in
  if(window.fbDB && window.fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid === FIREBASE.ADMIN_UID){
    saveAssignmentsRemote().catch(()=>{/* ignore */});
  }
  alert("Assignments + secret codes generated. Download codes CSV and distribute privately.");
}

function downloadCodesCSV(){
  const map = loadJSON(KEY_ASSIGN) || assignments || {};
  if(Object.keys(map).length === 0){ alert("No assignments generated yet."); return; }
  const lines = ['giver,code'];
  Object.keys(map).forEach(giver => lines.push(csvEscape(giver) + ',' + csvEscape(map[giver].code || '')));
  const csv = lines.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'secret_santa_codes.csv'; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ---------------- reveal flow ----------------
function revealByName(){
  const name = document.getElementById('revealName').value.trim();
  const code = document.getElementById('revealCode').value.trim();
  if(!name){ alert("Enter your name."); return; }
  if(!code){ alert("Enter your secret code."); return; }

  assignments = loadJSON(KEY_ASSIGN) || assignments || {};
  usedGivers = loadJSON(KEY_USED) || usedGivers || [];

  if(!assignments || Object.keys(assignments).length === 0){
    alert("Assignments not generated yet. Contact admin.");
    return;
  }
  const entry = assignments[name];
  if(!entry){ alert("Name not found. Check exact spelling."); return; }
  if(usedGivers.includes(name)){ alert("You already revealed your match. Only one attempt allowed."); return; }
  if(entry.code !== code){ alert("Invalid secret code for this name."); return; }

  const html = `<strong>${escapeHtml(name)} → ${escapeHtml(entry.receiver)}</strong><br/>
                <div class="small"><strong>Wishlist:</strong> ${escapeHtml(entry.wishlist || '(none)')}</div>
                <div class="small"><strong>Address:</strong> ${escapeHtml(entry.address || '(none)')}</div>`;
  document.getElementById('revealResult').innerHTML = html;

  // mark used locally and remote (if allowed)
  usedGivers.push(name); saveJSON(KEY_USED, usedGivers);
  if(window.fbDB && window.fbAuth && fbAuth.currentUser){
    // write under usedGivers/<name> = timestamp (requires DB rule allowing authenticated writes)
    try { fbDB.ref(`/secret-santa/2025/usedGivers/${encodeKey(name)}`).set({by: fbAuth.currentUser.uid || 'anon', at: Date.now()}); } catch(e){/* ignore */ }
  }
}

// ---------------- clear ----------------
function clearAll(){
  if(!confirm("Clear all participants, assignments and used attempts? This cannot be undone.")) return;
  localStorage.removeItem(KEY_PARTS); localStorage.removeItem(KEY_ASSIGN); localStorage.removeItem(KEY_USED);
  participants = []; assignments = {}; usedGivers = [];
  refreshAdminList();
  const res = document.getElementById('revealResult'); if(res) res.innerHTML = '';
  alert("Cleared.");
}

// ---------------- helpers ----------------
function csvEscape(s){ return '"' + (s||'').replace(/"/g,'""') + '"'; }
function escapeHtml(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function encodeKey(s){ return encodeURIComponent(s).replace(/\./g, '%2E'); }

// ---------------- Firebase integration (compat libs required in index.html) ----------------
const FIREBASE = {
  firebaseConfig: {
    apiKey: "AIzaSyDdbYqKXdqXLcBM_jMvNFynixDCEPHAueA",
  authDomain: "secret-santa-2025-ffd0f.firebaseapp.com",
  databaseURL: "https://secret-santa-2025-ffd0f-default-rtdb.firebaseio.com",
  projectId: "secret-santa-2025-ffd0f",
  storageBucket: "secret-santa-2025-ffd0f.firebasestorage.app",
  messagingSenderId: "343121297338",
  appId: "1:343121297338:web:1b35b6e2ae99fad7202783",
  measurementId: "G-TGPGVE6D76"
  },
  ADMIN_UID: "AIJN0S3zihSP6ueVWMJQuEpfLnu1" // replace if different
};

function initFirebase(){
  if(typeof firebase === 'undefined') return false;
  if(!firebase.apps.length){
    try { firebase.initializeApp(FIREBASE.firebaseConfig); } catch(e){ /* already init or error */ }
  }
  window.fbDB = firebase.database();
  window.fbAuth = firebase.auth();
  // update hint on auth changes
  fbAuth.onAuthStateChanged(u => {
    const hint = document.getElementById('adminPassHint');
    if(hint) hint.textContent = u ? 'signed-in (firebase)' : (localStorage.getItem(KEY_ADMINPASS) ? 'set' : 'not set');
  });
  // setup realtime syncing listeners
  setupRealtimeListeners();
  return true;
}

// sign-in helper for admin (email/password)
async function signInAdminFirebase(email, password){
  if(!window.fbAuth) return alert('Firebase not initialized');
  try{
    await fbAuth.signInWithEmailAndPassword(email, password);
    alert('Signed in as admin (firebase).');
  }catch(err){
    alert('Sign in failed: ' + err.message);
  }
}
window.signInAdminFirebase = signInAdminFirebase;

// save participants (admin only)
async function saveParticipantsRemote(){
  if(!window.fbDB) return;
  const user = fbAuth.currentUser; if(!user) return alert('Sign in as admin (firebase) to save participants.');
  if(user.uid !== FIREBASE.ADMIN_UID) return alert('Only admin can save participants remotely.');
  try{
    await fbDB.ref('/secret-santa/2025/participants').set(participants);
    await fbDB.ref('/secret-santa/2025/meta/lastUpdated').set({by: user.uid, at: Date.now()});
  }catch(err){ console.warn('saveParticipantsRemote failed', err); }
}
window.saveParticipantsRemote = saveParticipantsRemote;

// save assignments (admin only)
async function saveAssignmentsRemote(){
  if(!window.fbDB) return;
  const user = fbAuth.currentUser; if(!user) return alert('Sign in as admin (firebase) to save assignments.');
  if(user.uid !== FIREBASE.ADMIN_UID) return alert('Only admin can save assignments remotely.');
  try{
    await fbDB.ref('/secret-santa/2025/assignments').set(assignments);
    await fbDB.ref('/secret-santa/2025/meta/assignmentsUpdated').set({by: user.uid, at: Date.now()});
  }catch(err){ console.warn('saveAssignmentsRemote failed', err); }
}
window.saveAssignmentsRemote = saveAssignmentsRemote;

// load participants once (fallback)
async function loadParticipantsRemote(){
  if(!window.fbDB) return false;
  try{
    const snap = await fbDB.ref('/secret-santa/2025/participants').once('value');
    if(snap.exists()){
      participants = snap.val() || [];
      saveJSON(KEY_PARTS, participants);
      refreshAdminList();
      return true;
    }
  }catch(err){ console.warn('loadParticipantsRemote failed', err); }
  return false;
}
window.loadParticipantsRemote = loadParticipantsRemote;

// load assignments once (fallback)
async function loadAssignmentsRemote(){
  if(!window.fbDB) return false;
  try{
    const snap = await fbDB.ref('/secret-santa/2025/assignments').once('value');
    if(snap.exists()){
      assignments = snap.val() || {};
      saveJSON(KEY_ASSIGN, assignments);
      return true;
    }
  }catch(err){ console.warn('loadAssignmentsRemote failed', err); }
  return false;
}
window.loadAssignmentsRemote = loadAssignmentsRemote;

// realtime listeners - keep local state in sync when remote changes
function setupRealtimeListeners(){
  if(!window.fbDB) return;
  const partsRef = fbDB.ref('/secret-santa/2025/participants');
  partsRef.on('value', snap => {
    const val = snap.val();
    if(val){
      participants = val;
      saveJSON(KEY_PARTS, participants);
      refreshAdminList();
    }
  });
  const assignRef = fbDB.ref('/secret-santa/2025/assignments');
  assignRef.on('value', snap => {
    const val = snap.val();
    if(val){
      assignments = val;
      saveJSON(KEY_ASSIGN, assignments);
    }
  });
}

// ---------------- wire up UI functions for inline handlers ----------------
window.adminLogin = adminLogin;
window.setAdminPass = setAdminPass;
window.parseExcel = parseExcel;
window.addSingleParticipant = addSingleParticipant;
window.generateAllAssignments = generateAllAssignments;
window.downloadCodesCSV = downloadCodesCSV;
window.clearAll = clearAll;
window.revealByName = revealByName;
window.downloadCodesCSV = downloadCodesCSV;

// ---------------- init ----------------
(function init(){
  initFirebase();
  participants = loadJSON(KEY_PARTS) || [];
  assignments = loadJSON(KEY_ASSIGN) || {};
  usedGivers = loadJSON(KEY_USED) || [];
  if(participants.length) refreshAdminList();
  if(Object.keys(assignments).length) {
    const rr = document.getElementById('revealResult');
    if(rr) rr.innerHTML = '<div class="hint">Assignments exist. Enter your name & secret code to reveal your match (one attempt).</div>';
  }
  const pass = localStorage.getItem(KEY_ADMINPASS) || 'admin123';
  const hintEl = document.getElementById('adminPassHint');
  if(hintEl) hintEl.textContent = pass ? 'set' : 'not set';
})();