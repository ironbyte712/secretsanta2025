// Storage keys
const KEY_PARTS = 'ss_participants';
const KEY_ASSIGN = 'ss_assignments'; // giver -> {receiver,wishlist,address,code}
const KEY_USED = 'ss_used'; // array of givers who already revealed
const KEY_ADMINPASS = 'ss_admin_pass';

// In-memory
let participants = []; // {name,wishlist,address}
let assignments = {}; // giver -> {receiver,wishlist,address,code}
let usedGivers = []; // array of names
let adminPassword = 'admin123'; // default

// Firebase references
let fbDB = null;
let fbAuth = null;
let isFirebaseReady = false;
let isSyncEnabled = false; // sync to firebase when signed in as admin

// --- Firebase Configuration ---
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
  ADMIN_UID: "AIJN0S3zihSP6ueVWMJQuEpfLnu1"
};

// Utility: Load from localStorage (fallback when firebase unavailable)
function loadJSON(key){ 
  try { return JSON.parse(localStorage.getItem(key)); } catch(e){ return null; } 
}

// Utility: Save to localStorage (always)
function saveJSON(key, obj){ 
  localStorage.setItem(key, JSON.stringify(obj)); 
}

// --- Firebase Sync Functions ---

// Save admin password to Firebase (synced across all machines)
async function saveAdminPasswordToFirebase(pass) {
  if (!fbDB || !isSyncEnabled) return;
  try {
    await fbDB.ref('/secret-santa/2025/adminPassword').set(pass);
    saveJSON(KEY_ADMINPASS, pass);
  } catch(err) {
    console.warn('Failed to save admin password remotely:', err);
  }
}

// Save participants to Firebase
async function saveParticipantsToFirebase(parts) {
  if (!fbDB || !isSyncEnabled) return;
  try {
    await fbDB.ref('/secret-santa/2025/participants').set(parts);
    saveJSON(KEY_PARTS, parts);
  } catch(err) {
    console.warn('Failed to save participants remotely:', err);
  }
}

// Save assignments to Firebase
async function saveAssignmentsToFirebase(assign) {
  if (!fbDB || !isSyncEnabled) return;
  try {
    await fbDB.ref('/secret-santa/2025/assignments').set(assign);
    saveJSON(KEY_ASSIGN, assign);
  } catch(err) {
    console.warn('Failed to save assignments remotely:', err);
  }
}

// Save used givers to Firebase
async function saveUsedGiversToFirebase(used) {
  if (!fbDB || !isSyncEnabled) return;
  try {
    await fbDB.ref('/secret-santa/2025/usedGivers').set(used);
    saveJSON(KEY_USED, used);
  } catch(err) {
    console.warn('Failed to save used givers remotely:', err);
  }
}

// Load all data from Firebase
async function loadAllFromFirebase() {
  if (!fbDB) return false;
  try {
    const snap = await fbDB.ref('/secret-santa/2025').get();
    if (snap.exists()) {
      const data = snap.val();
      if (data.participants) {
        participants = data.participants;
        saveJSON(KEY_PARTS, participants);
      }
      if (data.assignments) {
        assignments = data.assignments;
        saveJSON(KEY_ASSIGN, assignments);
      }
      if (data.usedGivers) {
        usedGivers = data.usedGivers;
        saveJSON(KEY_USED, usedGivers);
      }
      if (data.adminPassword) {
        adminPassword = data.adminPassword;
        saveJSON(KEY_ADMINPASS, adminPassword);
      }
      return true;
    }
  } catch(err) {
    console.warn('Failed to load from Firebase:', err);
  }
  return false;
}

// Setup real-time listeners for ADMIN (listens for changes made by other admins)
function setupAdminListeners() {
  if (!fbDB || !isSyncEnabled) return;
  
  // Listen to participants changes
  fbDB.ref('/secret-santa/2025/participants').on('value', (snap) => {
    if (snap.exists()) {
      participants = snap.val();
      saveJSON(KEY_PARTS, participants);
      refreshAdminList();
    }
  }, (err) => console.warn('Listener error (participants):', err));

  // Listen to assignments changes
  fbDB.ref('/secret-santa/2025/assignments').on('value', (snap) => {
    if (snap.exists()) {
      assignments = snap.val();
      saveJSON(KEY_ASSIGN, assignments);
    }
  }, (err) => console.warn('Listener error (assignments):', err));

  // Listen to used givers changes
  fbDB.ref('/secret-santa/2025/usedGivers').on('value', (snap) => {
    if (snap.exists()) {
      usedGivers = snap.val();
      saveJSON(KEY_USED, usedGivers);
    }
  }, (err) => console.warn('Listener error (usedGivers):', err));

  // Listen to admin password changes
  fbDB.ref('/secret-santa/2025/adminPassword').on('value', (snap) => {
    if (snap.exists()) {
      adminPassword = snap.val();
      saveJSON(KEY_ADMINPASS, adminPassword);
      updateAdminPassHint();
    }
  }, (err) => console.warn('Listener error (adminPassword):', err));
}

// Setup listeners for regular users (read-only, auto-sync when data changes)
function setupPublicListeners() {
  if (!fbDB) return;
  
  // Listen to assignments changes (so participants see updates without refresh)
  fbDB.ref('/secret-santa/2025/assignments').on('value', (snap) => {
    if (snap.exists()) {
      assignments = snap.val();
      saveJSON(KEY_ASSIGN, assignments);
    }
  }, (err) => console.warn('Listener error (assignments):', err));

  // Listen to used givers (so one reveal blocks others immediately)
  fbDB.ref('/secret-santa/2025/usedGivers').on('value', (snap) => {
    if (snap.exists()) {
      usedGivers = snap.val();
      saveJSON(KEY_USED, usedGivers);
    }
  }, (err) => console.warn('Listener error (usedGivers):', err));
}

function updateAdminPassHint() {
  const hintEl = document.getElementById('adminPassHint');
  if (hintEl) {
    hintEl.textContent = isSyncEnabled ? 'synced (firebase)' : (adminPassword ? 'set (local)' : 'not set');
  }
}

// Initialize Firebase
function initFirebase() {
  if (typeof firebase === 'undefined') return false;
  if (!firebase.apps.length) {
    try {
      firebase.initializeApp(FIREBASE.firebaseConfig);
    } catch(e) { /* already init */ }
  }
  fbDB = firebase.database();
  fbAuth = firebase.auth();
  isFirebaseReady = true;

  fbAuth.onAuthStateChanged((user) => {
    if (user && user.uid === FIREBASE.ADMIN_UID) {
      isSyncEnabled = true;
      // Load all remote data on first login
      loadAllFromFirebase().then(() => {
        setupAdminListeners();
        updateAdminPassHint();
      });
    } else {
      isSyncEnabled = false;
      updateAdminPassHint();
    }
  });

  return true;
}

// Sign in admin (email/password) to enable remote sync
async function signInAdminFirebase(email, password) {
  if (!fbAuth) return alert('Firebase not initialized');
  try {
    await fbAuth.signInWithEmailAndPassword(email, password);
    alert('Signed in as admin. Remote sync enabled.');
  } catch(err) {
    alert('Sign in failed: ' + err.message);
  }
}
window.signInAdminFirebase = signInAdminFirebase;

// Sign out admin
async function signOutAdminFirebase() {
  if (!fbAuth) return;
  try {
    await fbAuth.signOut();
    isSyncEnabled = false;
    updateAdminPassHint();
    alert('Signed out. Sync disabled.');
  } catch(err) {
    alert('Sign out failed: ' + err.message);
  }
}
window.signOutAdminFirebase = signOutAdminFirebase;

// --- Admin Functions ---

function adminLogin() {
  const p = prompt("Enter admin password:");
  if (p === null) return;
  if (p === adminPassword) {
    document.getElementById('adminPanel').style.display = 'block';
    updateAdminPassHint();
    refreshAdminList();
    return;
  }
  alert("Wrong password.");
}

function setAdminPass() {
  const v = document.getElementById('adminPass').value;
  if (!v) { alert("Enter a new password."); return; }
  adminPassword = v;
  saveAdminPasswordToFirebase(v).catch(() => {
    // Fallback: just save locally if firebase fails
    saveJSON(KEY_ADMINPASS, adminPassword);
  });
  alert("Password saved" + (isSyncEnabled ? " and synced." : " locally."));
  document.getElementById('adminPass').value = '';
  updateAdminPassHint();
}

// --- Excel Parsing ---

function parseExcel() {
  const f = document.getElementById('excelInput').files[0];
  if (!f) { alert("Choose an Excel/CSV file first."); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    let data = e.target.result;
    let wb;
    try {
      wb = XLSX.read(data, {type: 'binary'});
    } catch(err) {
      wb = XLSX.read(data, {type: 'string'});
    }
    const first = wb.SheetNames[0];
    const ws = wb.Sheets[first];
    const rows = XLSX.utils.sheet_to_json(ws, {defval:''});
    
    const mapped = rows.map(r => {
      const lower = {};
      Object.keys(r).forEach(k => lower[k.trim().toLowerCase()] = r[k]);
      return {
        name: (lower['name'] || lower['full name'] || lower['participant'] || lower['nombre'] || '').toString().trim(),
        wishlist: (lower['wishlist'] || lower['wish list'] || lower['wishes'] || '').toString(),
        address: (lower['address'] || lower['home address'] || lower['direccion'] || '').toString()
      };
    }).filter(x => x.name && x.name.trim());
    
    if (mapped.length === 0) { alert("No valid rows with a Name column found."); return; }
    
    mapped.forEach(p => {
      if (!participants.some(pp => pp.name === p.name)) {
        participants.push({name: p.name, wishlist: p.wishlist, address: p.address});
      }
    });
    
    saveParticipantsToFirebase(participants).catch(() => {
      saveJSON(KEY_PARTS, participants);
    });
    refreshAdminList();
    alert("Loaded " + mapped.length + " participants.");
  };
  reader.readAsBinaryString(f);
}

function addSingleParticipant() {
  const n = document.getElementById('singleName').value.trim();
  if (!n) { alert("Enter a name."); return; }
  if (participants.some(p => p.name === n)) { alert("Name already exists."); return; }
  
  participants.push({
    name: n,
    wishlist: document.getElementById('singleWishlist').value.trim(),
    address: document.getElementById('singleAddress').value.trim()
  });
  
  saveParticipantsToFirebase(participants).catch(() => {
    saveJSON(KEY_PARTS, participants);
  });
  document.getElementById('singleName').value = '';
  document.getElementById('singleWishlist').value = '';
  document.getElementById('singleAddress').value = '';
  refreshAdminList();
}

function refreshAdminList() {
  const el = document.getElementById('adminList');
  if (participants.length === 0) { el.innerHTML = '<div class="hint">No participants loaded.</div>'; return; }
  let html = '<ul>';
  participants.forEach(p => {
    html += `<li>${escapeHtml(p.name)}</li>`;
  });
  html += '</ul>';
  el.innerHTML = html;
}

// --- Derangement Shuffle ---

function shuffleArray(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeDerangement(names) {
  if (names.length < 2) return null;
  let attempts = 0;
  let receivers;
  do {
    receivers = shuffleArray(names);
    attempts++;
    if (attempts > 5000) return null;
  } while (names.some((n, i) => n === receivers[i]));
  return receivers;
}

function genCode(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const array = new Uint8Array(len);
  window.crypto.getRandomValues(array);
  for (let i = 0; i < len; i++) s += chars[array[i] % chars.length];
  return s;
}

// --- Assignment Generation ---

function generateAllAssignments() {
  if (participants.length < 2) { alert("Need at least 2 participants."); return; }
  const names = participants.map(p => p.name);
  const receivers = makeDerangement(names);
  if (!receivers) { alert("Could not generate assignments. Try again."); return; }

  assignments = {};
  for (let i = 0; i < names.length; i++) {
    const giver = names[i];
    const receiver = receivers[i];
    const rdata = participants.find(p => p.name === receiver);
    const code = genCode(8);
    assignments[giver] = {
      receiver: receiver,
      wishlist: rdata ? rdata.wishlist : '',
      address: rdata ? rdata.address : '',
      code: code
    };
  }

  usedGivers = [];
  saveAssignmentsToFirebase(assignments).catch(() => {
    saveJSON(KEY_ASSIGN, assignments);
  });
  saveUsedGiversToFirebase(usedGivers).catch(() => {
    saveJSON(KEY_USED, usedGivers);
  });
  alert("Assignments + secret codes generated. Download the codes CSV and distribute each person's code privately.");
}

function downloadCodesCSV() {
  if (Object.keys(assignments).length === 0) { alert("No assignments generated yet."); return; }
  const lines = ['giver,code'];
  Object.keys(assignments).forEach(giver => {
    lines.push(csvEscape(giver) + ',' + csvEscape(assignments[giver].code || ''));
  });
  const csv = lines.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'secret_santa_codes.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Reveal Assignment ---

async function revealByName() {
  const name = document.getElementById('revealName').value.trim();
  const code = document.getElementById('revealCode').value.trim();
  if (!name) { alert("Enter your name."); return; }
  if (!code) { alert("Enter your secret code."); return; }

  // Try to load from firebase first if available
  if (fbDB && Object.keys(assignments).length === 0) {
    await loadAllFromFirebase();
  }

  if (!assignments || Object.keys(assignments).length === 0) {
    alert("Assignments not generated yet. Contact admin.");
    return;
  }

  const entry = assignments[name];
  if (!entry) {
    alert("Name not found. Check exact spelling.");
    return;
  }
  if (usedGivers.includes(name)) {
    alert("You already revealed your match. Only one attempt allowed.");
    return;
  }
  if (entry.code !== code) {
    alert("Invalid secret code for this name.");
    return;
  }

  const html = `<strong>${escapeHtml(name)} → ${escapeHtml(entry.receiver)}</strong><br/>
                <div class="small"><strong>Wishlist:</strong> ${escapeHtml(entry.wishlist || '(none)')}</div>
                <div class="small"><strong>Address:</strong> ${escapeHtml(entry.address || '(none)')}</div>`;
  document.getElementById('revealResult').innerHTML = html;

  usedGivers.push(name);
  saveUsedGiversToFirebase(usedGivers).catch(() => {
    saveJSON(KEY_USED, usedGivers);
  });
}

// --- Clear All ---

function clearAll() {
  if (!confirm("Clear all participants, assignments and used attempts? This cannot be undone.")) return;
  localStorage.removeItem(KEY_PARTS);
  localStorage.removeItem(KEY_ASSIGN);
  localStorage.removeItem(KEY_USED);
  participants = [];
  assignments = {};
  usedGivers = [];
  
  // Clear from firebase too
  if (fbDB && isSyncEnabled) {
    fbDB.ref('/secret-santa/2025/participants').set(null).catch(()=>{});
    fbDB.ref('/secret-santa/2025/assignments').set(null).catch(()=>{});
    fbDB.ref('/secret-santa/2025/usedGivers').set(null).catch(()=>{});
  }
  
  refreshAdminList();
  document.getElementById('revealResult').innerHTML = '';
  alert("Cleared.");
}

// --- Helper Functions ---

function csvEscape(s) { return '"' + (s || '').replace(/"/g,'""') + '"'; }
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, function (m) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]); });
}

// --- Expose Functions ---

window.adminLogin = adminLogin;
window.setAdminPass = setAdminPass;
window.parseExcel = parseExcel;
window.addSingleParticipant = addSingleParticipant;
window.downloadCodesCSV = downloadCodesCSV;
window.revealByName = revealByName;
window.clearAll = clearAll;
window.signInAdminFirebase = signInAdminFirebase;
window.signOutAdminFirebase = signOutAdminFirebase;

// --- Initialization ---

(function init() {
  // Load from localStorage first
  participants = loadJSON(KEY_PARTS) || [];
  assignments = loadJSON(KEY_ASSIGN) || {};
  usedGivers = loadJSON(KEY_USED) || [];
  adminPassword = loadJSON(KEY_ADMINPASS) || 'admin123';

  // Initialize Firebase
  if (initFirebase()) {
    setupPublicListeners(); // for non-admin: auto-sync assignments & used givers
  }

  if (participants.length) refreshAdminList();
  if (Object.keys(assignments).length) {
    document.getElementById('revealResult').innerHTML = '<div class="hint">Assignments exist. Enter your name & secret code to reveal your match (one attempt).</div>';
  }

  updateAdminPassHint();
})();