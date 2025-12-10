// client-side logic with robust Firebase initialization + realtime DB sync

// Storage keys
const KEY_PARTS = 'ss_participants';
const KEY_ASSIGN = 'ss_assignments';
const KEY_USED = 'ss_used';
const KEY_ADMINPASS = 'ss_admin_pass';

// In-memory
let participants = loadJSON(KEY_PARTS) || [];
let assignments = loadJSON(KEY_ASSIGN) || {};
let usedGivers = loadJSON(KEY_USED) || [];

// Utility
function saveJSON(key, obj){ localStorage.setItem(key, JSON.stringify(obj)); }
function loadJSON(key){ try { return JSON.parse(localStorage.getItem(key)); } catch(e){ return null; } }

// Helpers
function csvEscape(s){ return '"' + (s||'').replace(/"/g,'""') + '"'; }
function escapeHtml(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function encodeKey(s){ return encodeURIComponent(s).replace(/\./g, '%2E'); }

// ---------------- Firebase config (replace with your project values) ----------------
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
  ADMIN_UID: "yzPF4T8R6XeAv7XpXbku4qOliCu1" // replace with your admin UID
};

let fbDB = null;
let fbAuth = null;

// Wait for firebase SDK to be available (in case script load order/latency)
function waitForFirebaseSDK(timeout = 5000){
  return new Promise((resolve, reject) => {
    if(typeof window.firebase !== 'undefined') return resolve();
    const start = Date.now();
    const iv = setInterval(() => {
      if(typeof window.firebase !== 'undefined'){
        clearInterval(iv);
        return resolve();
      }
      if(Date.now() - start > timeout){
        clearInterval(iv);
        return reject(new Error('Firebase SDK not loaded.'));
      }
    }, 100);
  });
}

// Initialize Firebase app + services
function initFirebase(){
  if(typeof firebase === 'undefined') return false;
  try {
    if(!firebase.apps.length) firebase.initializeApp(FIREBASE.firebaseConfig);
  } catch(e){ /* ignore if already initialized */ }
  fbDB = firebase.database();
  fbAuth = firebase.auth();
  fbAuth.onAuthStateChanged(u => {
    const hint = document.getElementById('adminPassHint');
    if(hint) hint.textContent = u ? 'signed-in (firebase)' : (localStorage.getItem(KEY_ADMINPASS) ? 'set' : 'not set');
    const signedEl = document.getElementById('adminSignedIn');
    if(signedEl) signedEl.textContent = u ? (u.email || u.uid) : 'not signed in';
    if(u && u.uid === FIREBASE.ADMIN_UID){
      const panel = document.getElementById('adminPanel');
      if(panel) panel.style.display = 'block';
      refreshAdminList();
    }
  });
  setupRealtimeListeners();
  return true;
}

// ---------------- Admin / local auth ----------------
function adminLogin(){
  if(fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid === FIREBASE.ADMIN_UID){
    document.getElementById('adminPanel').style.display = 'block';
    refreshAdminList();
    return;
  }
  const stored = localStorage.getItem(KEY_ADMINPASS) || '';
  const p = prompt("Enter admin password (leave blank to sign-in with Firebase):");
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
    document.getElementById('adminPassHint').textContent = stored ? 'set' : 'not set';
    refreshAdminList();
    return;
  }
  alert("Wrong password.");
}
function setAdminPass(){
  const v = document.getElementById('adminPass').value;
  if(!v){ alert("Leave blank to keep existing password."); return; }
  localStorage.setItem(KEY_ADMINPASS, v);
  alert("Password saved locally.");
  document.getElementById('adminPass').value = '';
  // store a marker in DB (do not store plaintext). requires admin auth.
  if(fbDB && fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid === FIREBASE.ADMIN_UID){
    fbDB.ref('/secret-santa/2025/adminPassword').set({ setAt: Date.now(), by: fbAuth.currentUser.uid }).catch(()=>{});
  }
}

// ---------------- Excel parsing ----------------
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
    if(fbDB && fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid === FIREBASE.ADMIN_UID){
      saveParticipantsRemote().catch(()=>{});
    }
    alert("Loaded " + mapped.length + " participants.");
  };
  reader.readAsBinaryString(f);
}

function addSingleParticipant(){
  const n = document.getElementById('singleName').value.trim();
  if(!n){ alert("Enter a name."); return; }
  if(participants.some(p => p.name === n)){ alert("Name already exists."); return; }
  participants.push({name: n, wishlist: document.getElementById('singleWishlist').value.trim(), address: document.getElementById('singleAddress').value.trim()});
  saveJSON(KEY_PARTS, participants);
  document.getElementById('singleName').value=''; document.getElementById('singleWishlist').value=''; document.getElementById('singleAddress').value='';
  refreshAdminList();
  if(fbDB && fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid === FIREBASE.ADMIN_UID){
    saveParticipantsRemote().catch(()=>{});
  }
}

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
function makeDerangement(names){ if(names.length < 2) return null; let attempts = 0, receivers; do { receivers = shuffleArray(names); attempts++; if(attempts > 5000) return null; } while(names.some((n,i)=>n===receivers[i])); return receivers; }
function genCode(len){ const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; const array = new Uint8Array(len); window.crypto.getRandomValues(array); for(let i=0;i<len;i++) s += chars[array[i] % chars.length]; return s; }

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
  usedGivers = []; saveJSON(KEY_USED, usedGivers);
  if(fbDB && fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid === FIREBASE.ADMIN_UID){
    saveAssignmentsRemote().catch(()=>{});
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
  const a = document.createElement('a'); a.href = url; a.download = 'secret_santa_codes.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
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
    // try remote fallback
    if(fbDB) {
      loadAssignmentsRemote().then(ok => {
        if(ok) revealByName(); else alert("Assignments not generated yet. Contact admin.");
      });
    } else {
      alert("Assignments not generated yet. Contact admin.");
    }
    return;
  }
  const entry = assignments[name];
  if(!entry){ alert("Name not found. Check exact spelling."); return; }
  if(usedGivers.includes(name)){ alert("You already revealed your match. Only one attempt allowed."); return; }
  if(entry.code !== code){ alert("Invalid secret code for this name."); return; }

  const html = `<strong>${escapeHtml(name)} → ${escapeHtml(entry.receiver)}</strong><br/>
                <div class="small"><strong>Wishlist:</strong> ${escapeHtml(entry.wishlist || '(none)')}</div>
                <div class="small"><strong>Address:</strong> ${escapeHtml(entry.address || '(none)')}</div>`;
  const rr = document.getElementById('revealResult'); if(rr) rr.innerHTML = html;

  usedGivers.push(name); saveJSON(KEY_USED, usedGivers);
  if(fbDB && fbAuth && fbAuth.currentUser){
    fbDB.ref(`/secret-santa/2025/usedGivers/${encodeKey(name)}`).set({ by: fbAuth.currentUser.uid || 'anon', at: Date.now() }).catch(()=>{});
  }
}

// ---------------- clear ----------------
function clearAll(){
  if(!confirm("Clear all participants, assignments and used attempts? This cannot be undone.")) return;
  localStorage.removeItem(KEY_PARTS); localStorage.removeItem(KEY_ASSIGN); localStorage.removeItem(KEY_USED);
  participants = []; assignments = {}; usedGivers = [];
  refreshAdminList();
  const res = document.getElementById('revealResult'); if(res) res.innerHTML = '';
  if(fbDB && fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid === FIREBASE.ADMIN_UID){
    fbDB.ref('/secret-santa/2025/participants').remove().catch(()=>{});
    fbDB.ref('/secret-santa/2025/assignments').remove().catch(()=>{});
    fbDB.ref('/secret-santa/2025/usedGivers').remove().catch(()=>{});
  }
  alert("Cleared.");
}

// ---------------- Firebase remote helpers ----------------
async function saveParticipantsRemote(){
  if(!fbDB || !fbAuth || !fbAuth.currentUser) return;
  if(fbAuth.currentUser.uid !== FIREBASE.ADMIN_UID) return alert('Only admin can save participants remotely.');
  try{
    await fbDB.ref('/secret-santa/2025/participants').set(participants);
    await fbDB.ref('/secret-santa/2025/meta/lastUpdated').set({by: fbAuth.currentUser.uid, at: Date.now()});
  }catch(e){ console.warn(e); alert('Remote save failed: ' + e.message); }
}
async function saveAssignmentsRemote(){
  if(!fbDB || !fbAuth || !fbAuth.currentUser) return;
  if(fbAuth.currentUser.uid !== FIREBASE.ADMIN_UID) return alert('Only admin can save assignments remotely.');
  try{
    await fbDB.ref('/secret-santa/2025/assignments').set(assignments);
    await fbDB.ref('/secret-santa/2025/meta/assignmentsUpdated').set({by: fbAuth.currentUser.uid, at: Date.now()});
  }catch(e){ console.warn(e); alert('Remote save failed: ' + e.message); }
}
async function loadParticipantsRemote(){
  if(!fbDB) return false;
  try{
    const snap = await fbDB.ref('/secret-santa/2025/participants').get();
    if(snap.exists()){
      participants = snap.val() || [];
      saveJSON(KEY_PARTS, participants);
      refreshAdminList();
      return true;
    }
  }catch(e){ console.warn(e); }
  return false;
}
async function loadAssignmentsRemote(){
  if(!fbDB) return false;
  try{
    const snap = await fbDB.ref('/secret-santa/2025/assignments').get();
    if(snap.exists()){
      assignments = snap.val() || {};
      saveJSON(KEY_ASSIGN, assignments);
      return true;
    }
  }catch(e){ console.warn(e); }
  return false;
}

function setupRealtimeListeners(){
  if(!fbDB) return;
  fbDB.ref('/secret-santa/2025/participants').on('value', snap => {
    const val = snap.val();
    if(val){
      participants = val;
      saveJSON(KEY_PARTS, participants);
      refreshAdminList();
    }
  });
  fbDB.ref('/secret-santa/2025/assignments').on('value', snap => {
    const val = snap.val();
    if(val){
      assignments = val;
      saveJSON(KEY_ASSIGN, assignments);
    }
  });
}

// ---------------- auth UI helpers ----------------
async function signInAdminFirebase(email, password){
  if(!fbAuth) return alert('Firebase not initialized');
  try{ await fbAuth.signInWithEmailAndPassword(email, password); alert('Signed in via Firebase'); }
  catch(err){ alert('Sign in failed: ' + err.message); }
}
async function signInAdminUI(){
  const email = document.getElementById('adminEmail').value.trim();
  const pw = document.getElementById('adminPw').value;
  if(!email || !pw) return alert('Enter email and password.');
  await signInAdminFirebase(email, pw);
  document.getElementById('adminPw').value = '';
  if(fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid === FIREBASE.ADMIN_UID){
    document.getElementById('adminPanel').style.display = 'block';
    refreshAdminList();
    alert('Signed in as admin.');
  } else {
    alert('Signed in (not configured admin).');
  }
}
async function signOutAdmin(){
  if(fbAuth && fbAuth.currentUser){
    try{ await fbAuth.signOut(); }catch(e){ console.warn(e); }
  }
  document.getElementById('adminPanel').style.display = 'none';
  const hint = document.getElementById('adminPassHint');
  if(hint) hint.textContent = localStorage.getItem(KEY_ADMINPASS) ? 'set' : 'not set';
  const signedIn = document.getElementById('adminSignedIn');
  if(signedIn) signedIn.textContent = 'not signed in';
  alert('Signed out.');
}

// ---------------- init (wait for SDK, then init Firebase) ----------------
(async function init(){
  try {
    await waitForFirebaseSDK(5000);
    initFirebase();
  } catch(err) {
    console.error('Firebase SDK load failed:', err);
    // keep app working locally; show helpful message
    alert('Firebase not initialized. Remote sync disabled. Check console for details.');
  }

  participants = loadJSON(KEY_PARTS) || [];
  assignments = loadJSON(KEY_ASSIGN) || {};
  usedGivers = loadJSON(KEY_USED) || [];
  if(participants.length) refreshAdminList();
  if(Object.keys(assignments).length){
    const rr = document.getElementById('revealResult');
    if(rr) rr.innerHTML = '<div class="hint">Assignments exist. Enter your name & secret code to reveal your match (one attempt).</div>';
  }
  const pass = localStorage.getItem(KEY_ADMINPASS) || '';
  const hintEl = document.getElementById('adminPassHint');
  if(hintEl) hintEl.textContent = pass ? 'set' : 'not set';
})();

// expose functions for inline handlers
window.adminLogin = adminLogin;
window.setAdminPass = setAdminPass;
window.parseExcel = parseExcel;
window.addSingleParticipant = addSingleParticipant;
window.generateAllAssignments = generateAllAssignments;
window.downloadCodesCSV = downloadCodesCSV;
window.clearAll = clearAll;
window.revealByName = revealByName;
window.signInAdminUI = signInAdminUI;
window.signOutAdmin = signOutAdmin;