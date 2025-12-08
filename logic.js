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

// Admin auth
function adminLogin(){
    const stored = localStorage.getItem(KEY_ADMINPASS) || 'admin123';
    const p = prompt("Enter admin password:");
    if(p === null) return;
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

// Excel parsing (SheetJS)
function parseExcel(){
    const f = document.getElementById('excelInput').files[0];
    if(!f){ alert("Choose an Excel/CSV file first."); return; }
    const reader = new FileReader();
    reader.onload = function(e){
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
        // Normalize columns
        const mapped = rows.map(r => {
            const lower = {};
            Object.keys(r).forEach(k => lower[k.trim().toLowerCase()] = r[k]);
            return {
                name: (lower['name'] || lower['full name'] || lower['participant'] || lower['nombre'] || '').toString().trim(),
                wishlist: (lower['wishlist'] || lower['wish list'] || lower['wishes'] || '').toString(),
                address: (lower['address'] || lower['home address'] || lower['direccion'] || '').toString()
            };
        }).filter(x => x.name && x.name.trim());
        if(mapped.length === 0){ alert("No valid rows with a Name column found."); return; }
        // merge (avoid duplicates by name) — store wishlist/address but admin list will not show them
        mapped.forEach(p => {
            if(!participants.some(pp => pp.name === p.name)){
                participants.push({name: p.name, wishlist: p.wishlist, address: p.address});
            }
        });
        saveJSON(KEY_PARTS, participants);
        refreshAdminList();
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
    document.getElementById('singleName').value='';
    document.getElementById('singleWishlist').value='';
    document.getElementById('singleAddress').value='';
    refreshAdminList();
}

function refreshAdminList(){
    const el = document.getElementById('adminList');
    if(participants.length === 0){ el.innerHTML = '<div class="hint">No participants loaded.</div>'; return; }
    // Admin view: show names only (no wishlist/address)
    let html = '<ul>';
    participants.forEach(p => {
        html += `<li>${escapeHtml(p.name)}</li>`;
    });
    html += '</ul>';
    el.innerHTML = html;
}

// Derangement shuffle
function shuffleArray(a){
    const arr = a.slice();
    for(let i=arr.length-1;i>0;i--){
        const j = Math.floor(Math.random()*(i+1));
        [arr[i],arr[j]] = [arr[j],arr[i]];
    }
    return arr;
}
function makeDerangement(names){
    if(names.length < 2) return null;
    let attempts = 0;
    let receivers;
    do {
        receivers = shuffleArray(names);
        attempts++;
        if(attempts > 5000) return null;
    } while(names.some((n,i)=>n===receivers[i]));
    return receivers;
}

function genCode(len){
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    const array = new Uint8Array(len);
    window.crypto.getRandomValues(array);
    for(let i=0;i<len;i++) s += chars[array[i] % chars.length];
    return s;
}

function generateAllAssignments(){
    if(participants.length < 2){ alert("Need at least 2 participants."); return; }
    const names = participants.map(p => p.name);
    const receivers = makeDerangement(names);
    if(!receivers){ alert("Could not generate assignments. Try again."); return; }

    // Build assignments: giver -> receiver info (include per-giver secret code)
    assignments = {};
    for(let i=0;i<names.length;i++){
        const giver = names[i];
        const receiver = receivers[i];
        const rdata = participants.find(p => p.name === receiver);
        const code = genCode(8); // admin will distribute codes privately
        assignments[giver] = {
            receiver: receiver,
            wishlist: rdata ? rdata.wishlist : '',
            address: rdata ? rdata.address : '',
            code: code
        };
    }
    saveJSON(KEY_ASSIGN, assignments);
    saveJSON(KEY_PARTS, participants);
    // Reset used attempts when new assignments are generated
    usedGivers = [];
    saveJSON(KEY_USED, usedGivers);
    alert("Assignments + secret codes generated. Download the codes CSV and distribute each person's code privately.");
}

function downloadCodesCSV(){
    const map = loadJSON(KEY_ASSIGN) || assignments || {};
    if(Object.keys(map).length === 0){ alert("No assignments generated yet."); return; }
    const lines = ['giver,code'];
    Object.keys(map).forEach(giver => {
        lines.push(csvEscape(giver) + ',' + csvEscape(map[giver].code || ''));
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

function revealByName(){
    const name = document.getElementById('revealName').value.trim();
    const code = document.getElementById('revealCode').value.trim();
    if(!name){ alert("Enter your name."); return; }
    if(!code){ alert("Enter your secret code."); return; }

    // try to load from storage if page reloaded
    assignments = loadJSON(KEY_ASSIGN) || assignments || {};
    usedGivers = loadJSON(KEY_USED) || usedGivers || [];

    if(!assignments || Object.keys(assignments).length === 0){
        alert("Assignments not generated yet. Contact admin.");
        return;
    }
    const entry = assignments[name];
    if(!entry){
        alert("Name not found. Check exact spelling.");
        return;
    }
    if(usedGivers.includes(name)){
        alert("You already revealed your match. Only one attempt allowed.");
        return;
    }
    if(entry.code !== code){
        alert("Invalid secret code for this name.");
        return;
    }
    // reveal
    const html = `<strong>${escapeHtml(name)} → ${escapeHtml(entry.receiver)}</strong><br/>
                  <div class="small"><strong>Wishlist:</strong> ${escapeHtml(entry.wishlist || '(none)')}</div>
                  <div class="small"><strong>Address:</strong> ${escapeHtml(entry.address || '(none)')}</div>`;
    document.getElementById('revealResult').innerHTML = html;
    // mark used
    usedGivers.push(name);
    saveJSON(KEY_USED, usedGivers);
}

// clear everything
function clearAll(){
    if(!confirm("Clear all participants, assignments and used attempts? This cannot be undone.")) return;
    localStorage.removeItem(KEY_PARTS);
    localStorage.removeItem(KEY_ASSIGN);
    localStorage.removeItem(KEY_USED);
    participants = [];
    assignments = {};
    usedGivers = [];
    refreshAdminList();
    document.getElementById('revealResult').innerHTML = '';
    alert("Cleared.");
}

// small helpers
function csvEscape(s){ return '"' + (s||'').replace(/"/g,'""') + '"'; }
function escapeHtml(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g, function (m) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]); }); }

// expose functions used by inline onclick handlers
window.adminLogin = adminLogin;
window.setAdminPass = setAdminPass;
window.parseExcel = parseExcel;
window.addSingleParticipant = addSingleParticipant;
window.generateAllAssignments = generateAllAssignments;
window.downloadCodesCSV = downloadCodesCSV;
window.revealByName = revealByName;
window.clearAll = clearAll;

// init UI state
(function init(){
    participants = loadJSON(KEY_PARTS) || [];
    assignments = loadJSON(KEY_ASSIGN) || {};
    usedGivers = loadJSON(KEY_USED) || [];
    if(participants.length) refreshAdminList();
    if(Object.keys(assignments).length) document.getElementById('revealResult').innerHTML = '<div class="hint">Assignments exist. Enter your name & secret code to reveal your match (one attempt).</div>';
    const pass = localStorage.getItem(KEY_ADMINPASS) || 'admin123';
    document.getElementById('adminPassHint').textContent = pass ? 'set' : 'not set';
})();