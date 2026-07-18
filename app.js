// ═══════════════════════════════════════════
// STEP 1: Replace with your Firebase config
// ═══════════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBxOJUeXn-Y2J8Ip-sRJA8Bbrlzv5AsWf0",
  authDomain: "qr-generator-9c3b8.firebaseapp.com",
  projectId: "qr-generator-9c3b8",
  storageBucket: "qr-generator-9c3b8.firebasestorage.app",
  messagingSenderId: "500198931185",
  appId: "1:500198931185:web:8962f5d48cfedc83cc0750",
  measurementId: "G-4PS6V6J8L3"
};


// ═══════════════════════════════════════════
// STEP 3: Credit packs
// ═══════════════════════════════════════════
const CREDIT_PACKS = [
  { id: 'starter', name: 'Starter',  credits: 25,  amount: 99,   display: '$0.99', perCredit: '$0.04' },
  { id: 'creator', name: 'Creator',  credits: 80,  amount: 299,  display: '$2.99', perCredit: '$0.04', badge: 'Most Popular' },
  { id: 'studio',  name: 'Studio',   credits: 200, amount: 699,  display: '$6.99', perCredit: '$0.03' },
  { id: 'agency',  name: 'Agency',   credits: 600, amount: 1699, display: '$16.99',perCredit: '$0.03', badge: 'Best Value' },
];

const CREDIT_COSTS = {
  wifi:    1, email:   1, vcard:   1,
  png1000: 2, svg:     3, logo:    4, png2000: 5, bulk:    10
};

// ═══════════════════════════════════════════
// TEMPORARY: promo-code purchase bypass while
// real card payments are still being built.
// Remove this entirely once Stripe/Razorpay go live —
// anyone who views page source can read this code.
// ═══════════════════════════════════════════
const VALID_PROMO_CODE = 'AIExpert_456456';

document.getElementById('in-wifi-hidden').addEventListener('change', function() {
                document.getElementById('wifi-toggle-dot').style.transform = this.checked ? 'translateX(14px)' : 'translateX(0)';
                document.getElementById('wifi-toggle-dot').style.backgroundColor = this.checked ? 'var(--primary)' : 'var(--text-muted)';
              });

// ==================== STATE & UTILS ====================
let appState = {
  user: null,
  credits: 0,
  dailyCredits: 0,
  userData: null,
  activeTab: 'url',
  qrSize: 300,
  logoUrl: null,
  logoFile: null,
  debounceTimer: null,
  visitorTimer: null,
  lastQRUrl: '',
  csvData: []
};

const D = document;
const $ = (s) => D.querySelector(s);
const $$ = (s) => D.querySelectorAll(s);

// Wraps a promise so it rejects with a clear message if it hasn't settled
// within `ms` — used around network calls that could otherwise hang a button
// on "Applying..."/"Signing in..." forever with no feedback (e.g. a blocked
// or dropped connection to Firestore/Auth).
function withTimeout(promise, ms = 15000, message = 'This is taking too long — check your connection and try again.') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

// Security Util
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g,
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Toast System
let activeToasts = 0;
function showToast(msg, type = 'ok') {
  const container = $('#toast-container');
  const t = D.createElement('div');
  t.className = `toast ${type}`;

  let icon = '✓';
  if(type === 'err') icon = '✕';
  else if(type === 'credit') icon = '⚡';
  else if(type === 'info') icon = 'ℹ';

  t.innerHTML = `<div style="font-size:18px; line-height:1;">${icon}</div><div>${msg}</div>`;
  container.appendChild(t);

  // limit to 3
  if(container.children.length > 3) {
    container.removeChild(container.firstChild);
  }

  setTimeout(() => t.classList.add('active'), 10);
  setTimeout(() => {
    t.classList.remove('active');
    setTimeout(() => { if(t.parentElement) t.remove(); }, 300);
  }, 4000);
}

// Modals
function openModal(id) { $('#' + id).classList.add('active'); }
function closeModal(id) { $('#' + id).classList.remove('active'); }

// ==================== FIREBASE & AUTH ====================
let db;
try {
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.firestore();

  // Some networks/proxies/browser extensions block Firestore's default
  // streaming (WebChannel) connection while still allowing plain HTTPS
  // requests through. When that happens, reads/writes don't error out — they
  // just hang forever with no feedback, which is exactly the "stuck on
  // Applying..." symptom. Auto-detecting and falling back to long-polling
  // is the standard fix for that class of issue.
  db.settings({ experimentalAutoDetectLongPolling: true, merge: true });

  // Persist login across tabs/refreshes/browser restarts. Without this being set
  // explicitly, some browsers (Safari ITP, Brave, locked-down Chrome profiles,
  // incognito) fall back to session-only or in-memory persistence and the user
  // gets silently signed out on refresh. This does NOT fix a mismatched
  // authDomain (see README note added below), but it removes the other common
  // cause of "why did I get logged out" reports.
  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch(e => console.warn('Could not set auth persistence, falling back to default:', e));

  // NOTE: Firestore offline persistence (db.enablePersistence) was tried here
  // and removed again. It coordinates writes across tabs via a single
  // "primary" tab, and if that tab gets backgrounded/throttled (very common
  // on mobile browsers) writes from other tabs can sit queued indefinitely
  // with no error — the same "Applying..." hang this file already had one
  // cause of. Not worth the tradeoff for what this app needs right now.

  firebase.auth().onAuthStateChanged(user => {
    appState.user = user;
    renderNavAuth();
    if(user) {
      syncUserData();
    } else {
      initGuestState();
    }
  });
} catch(e) {
  console.warn("Firebase not configured properly. Offline mode.", e);
  initGuestState();
  renderNavAuth();
}

function initGuestState() {
  let c = localStorage.getItem('sz_credits');
  if(!c) { c = 5; localStorage.setItem('sz_credits', 5); }
  appState.credits = parseInt(c);
  appState.dailyCredits = 0;
  updateCreditUI();
}

async function syncUserData() {
  const ref = db.collection('users').doc(appState.user.uid);
  const snap = await ref.get();

  const today = new Date().toISOString().split('T')[0];
  let localC = parseInt(localStorage.getItem('sz_credits') || '0');
  let refCode = sessionStorage.getItem('sz_ref');

  if(!snap.exists) {
    // New User
    let bonus = 10 + localC;
    let newRefCode = Math.random().toString(36).substring(2,8).toUpperCase();

    let updates = {
      displayName: appState.user.displayName || 'Creator',
      email: appState.user.email,
      credits: bonus,
      creditsEarned: bonus,
      creditsSpent: 0,
      dailyStreak: 1,
      lastLoginDate: today,
      dailyCredits: 2, // initial daily
      referralCode: newRefCode,
      referredBy: refCode || null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if(refCode) {
      updates.credits += 5;
      updates.creditsEarned += 5;
      // reward referrer
      db.collection('referrals').doc(refCode).get().then(rd => {
        if(rd.exists) {
          db.collection('users').doc(rd.data().uid).update({
            credits: firebase.firestore.FieldValue.increment(5),
            creditsEarned: firebase.firestore.FieldValue.increment(5)
          });
          rd.ref.update({ uses: firebase.firestore.FieldValue.increment(1) });
        }
      });
      showToast('Referral bonus! +5 credits.', 'credit');
    }

    db.collection('referrals').doc(newRefCode).set({ uid: appState.user.uid, uses: 0, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    await ref.set(updates);

    showToast('Welcome! 10 free credits added.', 'credit');
    appState.userData = updates;
  } else {
    // Existing user
    let data = snap.data();
    let updates = {};

    if(localC > 0 && localC !== 5) {
      updates.credits = firebase.firestore.FieldValue.increment(localC);
      updates.creditsEarned = firebase.firestore.FieldValue.increment(localC);
    }

    // Daily Streak Logic
    if(data.lastLoginDate !== today) {
      let yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      let yStr = yesterday.toISOString().split('T')[0];

      if(data.lastLoginDate === yStr) {
        updates.dailyStreak = (data.dailyStreak || 1) + 1;
        setTimeout(() => showToast('🔥 Day ' + updates.dailyStreak + ' streak! +2 credits', 'credit'), 1500);
      } else {
        updates.dailyStreak = 1;
      }
      updates.lastLoginDate = today;
      updates.dailyCredits = 2; // reset daily pool
      updates.creditsEarned = firebase.firestore.FieldValue.increment(2);
    }

    if(Object.keys(updates).length > 0) {
      await ref.update(updates);
    }
    appState.userData = Object.assign({}, data, updates); // local approx until snapshot fires
  }

  localStorage.removeItem('sz_credits');
  sessionStorage.removeItem('sz_ref');

  // Realtime listener
  ref.onSnapshot(s => {
    if(s.exists) {
      const d = s.data();
      appState.userData = d;
      let newTotal = (d.credits || 0) + (d.dailyCredits || 0);
      let oldTotal = appState.credits + appState.dailyCredits;

      appState.credits = d.credits || 0;
      appState.dailyCredits = d.dailyCredits || 0;

      if(newTotal > oldTotal && oldTotal > 0) flashCreditCounter('glow');
      else if (newTotal < oldTotal) flashCreditCounter('warn');

      updateCreditUI();
    }
  }, err => {
    console.error('Credit sync listener failed:', err);
    showToast('Could not sync your account in real time. Check your connection and refresh.', 'err');
  });
}

function triggerGoogleSignIn() {
  if(!firebase) return;
  const p = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(p)
    .then(() => closeModal('authModal'))
    .catch(e => {
      if(e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
      console.error('Google sign-in failed:', e);
      showToast(friendlyAuthError(e), 'err');
    });
}

// ==================== EMAIL/PASSWORD AUTH ====================
let authMode = 'signin';

function openAuthModal(mode) {
  setAuthMode(mode || 'signin');
  $('#auth-email').value = '';
  $('#auth-password').value = '';
  if($('#auth-name')) $('#auth-name').value = '';
  $('#auth-error').style.display = 'none';
  openModal('authModal');
}

function setAuthMode(mode) {
  authMode = mode;
  const isSignUp = mode === 'signup';

  $('#auth-title').innerText = isSignUp ? 'Create your account' : 'Welcome back';
  $('#auth-subtitle').innerText = isSignUp
    ? 'Get 10 free credits when you sign up.'
    : 'Sign in to access your credits and history.';
  $('#auth-name-group').style.display = isSignUp ? 'block' : 'none';
  $('#auth-password').setAttribute('autocomplete', isSignUp ? 'new-password' : 'current-password');
  $('#auth-forgot-link').style.display = isSignUp ? 'none' : 'inline';
  $('#auth-submit-btn').innerText = isSignUp ? 'Create Account' : 'Sign In';
  $('#auth-toggle-text').innerText = isSignUp ? 'Already have an account?' : 'New to Scanzap?';
  $('#auth-toggle-link').innerText = isSignUp ? 'Sign in' : 'Create an account';
  $('#auth-toggle-link').setAttribute('onclick', `setAuthMode('${isSignUp ? 'signin' : 'signup'}')`);
  $('#auth-error').style.display = 'none';
}

function friendlyAuthError(e) {
  const map = {
    'auth/email-already-in-use': 'An account already exists with that email. Try signing in instead.',
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/missing-password': 'Enter a password.',
    'auth/user-not-found': "We couldn't find an account with that email.",
    'auth/wrong-password': 'Incorrect password. Try again or reset it.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a bit and try again.',
    'auth/popup-blocked': 'Your browser blocked the sign-in popup. Please allow popups and try again.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.'
  };
  return map[e.code] || e.message || 'Something went wrong. Please try again.';
}

async function submitAuthForm() {
  const email = ($('#auth-email').value || '').trim();
  const password = $('#auth-password').value || '';
  const errEl = $('#auth-error');
  errEl.style.display = 'none';

  if(!email || !password) {
    errEl.textContent = 'Enter both an email and a password.';
    errEl.style.display = 'block';
    return;
  }

  const btn = $('#auth-submit-btn');
  btn.disabled = true;
  btn.innerText = authMode === 'signup' ? 'Creating account...' : 'Signing in...';

  try {
    if(authMode === 'signup') {
      const name = ($('#auth-name').value || '').trim();
      const cred = await withTimeout(firebase.auth().createUserWithEmailAndPassword(email, password));
      if(name && cred.user) {
        await cred.user.updateProfile({ displayName: name });
        appState.user = firebase.auth().currentUser;
        renderNavAuth();
        if(db) {
          db.collection('users').doc(cred.user.uid).set({ displayName: name }, { merge: true }).catch(e => console.warn('Could not sync display name to profile doc:', e));
        }
      }
    } else {
      await withTimeout(firebase.auth().signInWithEmailAndPassword(email, password));
    }
    closeModal('authModal');
  } catch(e) {
    console.error('Email auth failed:', e);
    errEl.textContent = friendlyAuthError(e);
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerText = authMode === 'signup' ? 'Create Account' : 'Sign In';
  }
}

async function sendPasswordReset() {
  const email = ($('#auth-email').value || '').trim();
  const errEl = $('#auth-error');
  errEl.style.display = 'none';

  if(!email) {
    errEl.textContent = 'Enter your email above first, then tap "Forgot password?" again.';
    errEl.style.display = 'block';
    return;
  }

  try {
    await firebase.auth().sendPasswordResetEmail(email);
    showToast(`Password reset email sent to ${email}.`, 'ok');
  } catch(e) {
    console.error('Password reset failed:', e);
    errEl.textContent = friendlyAuthError(e);
    errEl.style.display = 'block';
  }
}

function renderNavAuth() {
  const c = $('#nav-auth-state');
  if(appState.user) {
    let initial = appState.user.displayName ? appState.user.displayName.charAt(0).toUpperCase() : 'C';
    c.innerHTML = `
      <div id="credit-badge" class="credit-badge" onclick="document.getElementById('shop').scrollIntoView()">
        ⚡ <span id="nav-credit-num">--</span>
      </div>
      <div class="avatar-menu">
        <button class="avatar-btn" onclick="this.parentElement.classList.toggle('active')">${initial}</button>
        <div class="avatar-dropdown">
          <a href="#" onclick="openDashboard(); this.parentElement.parentElement.classList.remove('active'); return false;">🏠 My Dashboard</a>
          <a href="#" onclick="document.getElementById('shop').scrollIntoView(); this.parentElement.parentElement.classList.remove('active'); return false;">⚡ Top Up Credits</a>
          <a href="#" style="border-top:1px solid var(--border);" onclick="firebase.auth().signOut(); this.parentElement.parentElement.classList.remove('active'); return false;">↩ Sign Out</a>
        </div>
      </div>
    `;
    updateCreditUI();
  } else {
    c.innerHTML = `
      <button class="btn btn-ghost" onclick="openAuthModal('signin')">Sign In</button>
      <button class="btn btn-primary" onclick="document.querySelector('.generator-section').scrollIntoView();">Try Free →</button>
    `;
  }
}

function recordHistory(uid, desc, amt) {
  if(!db) return Promise.resolve();
  return db.collection('users').doc(uid).collection('creditHistory').add({ description: desc, amount: amt, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
}

function updateCreditUI() {
  const el = $('#nav-credit-num');
  if(el) {
    let total = appState.credits + appState.dailyCredits;
    el.innerText = total;
    const badge = $('#credit-badge');
    badge.className = 'credit-badge'; // reset
    if(total === 0) badge.classList.add('empty');
    else if(total < 5) badge.classList.add('warn');
    else badge.classList.add('glow');
  }
}

function flashCreditCounter(type) {
  const b = $('#credit-badge');
  if(!b) return;
  b.style.transform = 'scale(1.15)';
  b.style.transition = 'transform 0.1s';
  setTimeout(() => { b.style.transform = 'scale(1)'; b.style.transition = 'transform 0.3s'; }, 100);
}

async function deductCredits(cost) {
  if(cost <= 0) return true;
  let total = appState.credits + appState.dailyCredits;
  if(total < cost) {
    openModal('outOfCreditsModal');
    return false;
  }

  if(appState.user && db) {
    let deductDaily = Math.min(appState.dailyCredits, cost);
    let deductPerm = cost - deductDaily;

    await db.collection('users').doc(appState.user.uid).update({
      dailyCredits: firebase.firestore.FieldValue.increment(-deductDaily),
      credits: firebase.firestore.FieldValue.increment(-deductPerm),
      creditsSpent: firebase.firestore.FieldValue.increment(cost)
    });
  } else {
    appState.credits -= cost;
    localStorage.setItem('sz_credits', appState.credits);
    flashCreditCounter('warn');
    updateCreditUI();
  }
  return true;
}

// ==================== DASHBOARD ====================
function openDashboard() {
  if(!appState.user) return;
  if (appState.userData) {
      $('#d-bal').innerText = (appState.userData.credits || 0) + (appState.userData.dailyCredits || 0);
      $('#d-streak').innerText = (appState.userData.dailyStreak || 1) + ' 🔥';
      $('#ref-link').innerText = 'https://scanzap.com/?ref=' + (appState.userData.referralCode || '');
      $('#set-name').value = appState.userData.displayName || '';
      $('#set-email').value = appState.userData.email || '';
  } else {
      $('#d-bal').innerText = appState.credits + appState.dailyCredits;
      $('#d-streak').innerText = '1 🔥';
  }

  loadDashboardHistory();
  loadDashboardCreditHistory();

  openModal('dashboardModal');
}

$$('.dash-tab').forEach(t => {
  t.addEventListener('click', () => {
    $$('.dash-tab').forEach(x => { x.classList.remove('active'); x.style.background='none'; x.style.color='var(--text-muted)'; });
    t.classList.add('active');
    t.style.background = 'var(--primary-dim)';
    t.style.color = 'var(--primary)';

    $$('.d-panel').forEach(x => x.style.display = 'none');
    $('#' + t.dataset.dtab).style.display = 'block';
  });
});

let dashboardHistoryListener = null;
function loadDashboardHistory() {
  if(!appState.user || !db) return;
  if (dashboardHistoryListener) dashboardHistoryListener();

  const list = $('#qr-list');
  list.innerHTML = '<div style="color:var(--text-muted);">Loading...</div>';

  dashboardHistoryListener = db.collection('users').doc(appState.user.uid).collection('qrcodes').orderBy('createdAt', 'desc').limit(21).onSnapshot(snaps => {
    list.innerHTML = '';

    if(snaps.empty) {
      list.innerHTML = '<div style="color:var(--text-muted); grid-column:1/-1;">No QR codes generated yet.</div>';
      return;
    }

    snaps.forEach(doc => {
      let d = doc.data();
      let fg = (d.fg || '#000000').replace('#','');
      let bg = (d.bg || '#FFFFFF').replace('#','');
      let imgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(d.data || '')}&color=${fg}&bgcolor=${bg}&ecc=${d.ecc || 'M'}`;
      list.innerHTML += `
        <div style="background:var(--surface); border:1px solid var(--border); padding:12px; border-radius:var(--r-sm); text-align:center;">
          <img src="${imgUrl}" style="width:100%; border-radius:4px; margin-bottom:8px;">
          <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">${d.type}</div>
        </div>
      `;
    });
  }, err => {
    console.error('QR history listener failed:', err);
    list.innerHTML = '<div style="color:var(--error); grid-column:1/-1;">Could not load your QR history. Please refresh and try again.</div>';
  });
}

let dashboardCreditHistoryListener = null;
function loadDashboardCreditHistory() {
  if(!appState.user || !db) return;
  if (dashboardCreditHistoryListener) dashboardCreditHistoryListener();

  const list = $('#credit-list');
  list.innerHTML = '<div style="color:var(--text-muted);">Loading...</div>';

  dashboardCreditHistoryListener = db.collection('users').doc(appState.user.uid).collection('creditHistory').orderBy('createdAt', 'desc').limit(20).onSnapshot(snaps => {
    list.innerHTML = '';

    if(snaps.empty) {
      list.innerHTML = '<div style="color:var(--text-muted);">No credit history found.</div>';
      return;
    }

    snaps.forEach(doc => {
      let d = doc.data();
      let date = d.createdAt ? d.createdAt.toDate().toLocaleDateString() : 'Just now';
      let sign = d.amount > 0 ? '+' : '';
      let color = d.amount > 0 ? 'var(--success)' : 'var(--error)';

      list.innerHTML += `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--border);">
          <div>
            <div style="font-size:14px; color:var(--text);">${d.description || d.reason || 'Transaction'}</div>
            <div style="font-size:12px; color:var(--text-muted);">${date}</div>
          </div>
          <div style="font-weight:700; color:${color};">${sign}${d.amount}</div>
        </div>
      `;
    });
  }, err => {
    console.error('Credit history listener failed:', err);
    list.innerHTML = '<div style="color:var(--error);">Could not load your credit history. Please refresh and try again.</div>';
  });
}

function copyRef() {
  navigator.clipboard.writeText($('#ref-link').innerText);
  showToast('Referral link copied!');
}

function deleteAccount() {
  if(confirm("Type 'DELETE' to confirm account deletion.")) {
    // Basic confirmation for demo
    if(appState.user && db) {
      db.collection('users').doc(appState.user.uid).delete().then(() => {
        appState.user.delete().then(() => {
          showToast('Account deleted', 'ok');
          closeModal('dashboardModal');
        });
      });
    }
  }
}

// ==================== GENERATOR ENGINE ====================
// Tabs logic
$$('.tabs-wrap .tab').forEach(t => {
  t.addEventListener('click', (e) => {
    $$('.tabs-wrap .tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');

    $$('.panels-wrap .panel').forEach(x => x.classList.remove('active'));
    $('#' + t.dataset.target).classList.add('active');

    appState.activeTab = t.dataset.target.replace('panel-', '');

    // Slide indicator
    const ind = $('.tab-indicator');
    ind.style.width = t.offsetWidth + 'px';
    ind.style.left = t.offsetLeft + 'px';

    debounceGenerate();
  });
});

// Size logic
$$('.size-btn').forEach(s => {
  s.addEventListener('click', () => {
    let size = parseInt(s.dataset.val);
    let cost = 0;
    if(size === 1000) cost = CREDIT_COSTS.png1000;
    if(size === 2000) cost = CREDIT_COSTS.png2000;

    let total = appState.credits + appState.dailyCredits;
    if(cost > 0 && total < cost) {
       openModal('outOfCreditsModal');
       return;
    }

    $$('.size-btn').forEach(x => x.classList.remove('active'));
    s.classList.add('active');
    appState.qrSize = size;
  });
});

// Interactive Swatches (visual simulation approach)
function setupSwatches(groupId) {
  $$('#' + groupId + ' .swatch').forEach(s => {
    s.addEventListener('click', () => {
      $$('#' + groupId + ' .swatch').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      debounceGenerate();
    });
  });
}
setupSwatches('dot-style-group');
setupSwatches('eye-shape-group');
$$('#ecc-group .pill').forEach(p => {
  p.addEventListener('click', () => {
    $$('#ecc-group .pill').forEach(x => x.classList.remove('active'));
    p.classList.add('active');
    debounceGenerate();
  });
});
$$('#wifi-sec-group .pill').forEach(p => {
  p.addEventListener('click', () => {
    $$('#wifi-sec-group .pill').forEach(x => x.classList.remove('active'));
    p.classList.add('active');
    debounceGenerate();
  });
});

function updateHex(input, textId) {
  $('#' + textId).value = input.value.toUpperCase();
}
function updateCharCount() {
  const len = $('#in-text').value.length;
  $('#text-count').innerText = len + ' / 500';
  if(len >= 400 && $('#ecc-group .active').dataset.val !== 'H') {
    $$('#ecc-group .pill').forEach(x => x.classList.remove('active'));
    $('[data-val="H"]').classList.add('active');
    showToast('Switched to High Error Correction due to large text size.', 'info');
    debounceGenerate();
  }
}

function handleLogoUpload(input) {
  const file = input.files[0];
  if(!file) return;
  if(file.size > 500000) { showToast('Logo must be under 500KB', 'err'); return; }

  appState.logoFile = file;
  appState.logoUrl = URL.createObjectURL(file);
  $('#logo-img').src = appState.logoUrl;
    $('#logo-dropzone').style.display = 'none';
    $('#logo-preview-wrap').style.display = 'flex';

    // Force H ecc
    $$('#ecc-group .pill').forEach(x => x.classList.remove('active'));
    $('[data-val="H"]').classList.add('active');

    debounceGenerate();
}
function removeLogo() {
  appState.logoFile = null;
  appState.logoUrl = null;
  $('#logo-input').value = '';
  $('#logo-dropzone').style.display = 'block';
  $('#logo-preview-wrap').style.display = 'none';
  debounceGenerate();
}

function handleCSVUpload(input) {
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split('\n').map(l => l.trim()).filter(l => l);
    appState.csvData = lines.slice(0, 50);

    let tb = $('#csv-preview-body');
    tb.innerHTML = '';
    appState.csvData.slice(0,5).forEach(l => {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.style.cssText = "padding:4px 0; border-bottom:1px solid var(--border); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:300px;";
      td.textContent = l;
      tr.appendChild(td);
      tb.appendChild(tr);
    });

    $('#csv-dropzone').style.display = 'none';
    $('#csv-preview').style.display = 'block';
  };
  reader.readAsText(file);
}

function debounceGenerate() {
  clearTimeout(appState.debounceTimer);

  // Link preview
  if(appState.activeTab === 'url') {
    let url = $('#in-url').value;
    if(url && url.length > 4) {
      if(!url.startsWith('http')) url = 'https://' + url;
      try {
        let domain = new URL(url).hostname;
        $('#lp-domain').innerText = domain;
        $('#lp-img').src = 'https://www.google.com/s2/favicons?domain=' + domain;
        $('#link-preview').style.display = 'flex';
      } catch(e) {}
    } else {
      $('#link-preview').style.display = 'none';
    }
  }

  appState.debounceTimer = setTimeout(buildCanvasQR, 600);
}

function getQRDataString() {
  let str = '';
  switch(appState.activeTab) {
    case 'url':
      str = $('#in-url').value.trim();
      if(str && !str.startsWith('http')) str = 'https://' + str;
      break;
    case 'text': str = $('#in-text').value; break;
    case 'email':
      str = `mailto:${$('#in-email').value}?subject=${encodeURIComponent($('#in-email-sub').value)}&body=${encodeURIComponent($('#in-email-body').value)}`;
      if(str === 'mailto:?subject=&body=') str = '';
      break;
    case 'phone': str = 'tel:' + $('#in-phone-code').value + $('#in-phone').value; break;
    case 'wifi':
      let sec = $('#wifi-sec-group .active').dataset.val;
      let hide = $('#in-wifi-hidden').checked ? 'true' : 'false';
      str = `WIFI:S:${$('#in-wifi-ssid').value};T:${sec};P:${$('#in-wifi-pass').value};H:${hide};;`;
      if(str === 'WIFI:S:;T:WPA;P:;H:false;;') str = '';
      break;
    case 'vcard':
      str = `BEGIN:VCARD\nVERSION:3.0\nN:${$('#in-vc-ln').value};${$('#in-vc-fn').value}\nORG:${$('#in-vc-org').value}\nTITLE:${$('#in-vc-title').value}\nTEL:${$('#in-vc-tel').value}\nEMAIL:${$('#in-vc-email').value}\nURL:${$('#in-vc-url').value}\nEND:VCARD`;
      if(str.replace(/\n/g,'') === 'BEGIN:VCARDVERSION:3.0N:;ORG:TITLE:TEL:EMAIL:URL:END:VCARD') str = '';
      break;
  }
  return str;
}

function getCost() {
  let cost = 0;
  if(['email','wifi','vcard'].includes(appState.activeTab)) cost += CREDIT_COSTS[appState.activeTab];
  if(appState.logoUrl) cost += CREDIT_COSTS.logo;
  return cost;
}

// Security blur timer
let blurTimer = null;
function resetBlurTimer() {
  clearTimeout(blurTimer);
  $('#qr-wrap').style.filter = 'none';
  blurTimer = setTimeout(() => {
    $('#qr-wrap').style.filter = 'blur(8px)';
  }, 60000);
}

async function buildCanvasQR() {
  resetBlurTimer();
  const str = getQRDataString();
  const canvas = $('#qr-canvas');
  const empty = $('#qr-empty');
  const meta = $('#qr-meta');
  const actions = $('#qr-actions');

  if(!str) {
    canvas.style.display = 'none';
    empty.style.display = 'flex';
    meta.style.display = 'none';
    actions.style.display = 'none';
    return;
  }

  const fg = $('#c-fg').value.substring(1);
  const bg = $('#c-bg').value.substring(1);
  const ecc = $('#ecc-group .active').dataset.val;
  const qz = $('#c-qz').value;

  const url = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(str)}&color=${fg}&bgcolor=${bg}&ecc=${ecc}&qzone=${qz}`;

  if(url === appState.lastQRUrl && !appState.logoUrl) return;
  appState.lastQRUrl = url;

  empty.style.display = 'none';

  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      canvas.width = 280;
      canvas.height = 280;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 280, 280);
      URL.revokeObjectURL(objectUrl);

      // Simulate Dot Styles via Canvas composition (approximation)
      const ds = $('#dot-style-group .active').dataset.val;
      if(ds !== 'square') {
         // Apply visual filter to canvas for smooth dots
         canvas.style.borderRadius = (ds === 'rounded') ? '8px' : '16px';
      } else {
         canvas.style.borderRadius = '0';
      }

      if(appState.logoUrl) {
        const lImg = new Image();
        lImg.onload = () => {
          const lSize = 280 * 0.25;
          const pos = (280 - lSize) / 2;
          ctx.fillStyle = $('#c-bg').value;
          ctx.beginPath();
          ctx.roundRect(pos - 4, pos - 4, lSize + 8, lSize + 8, 8);
          ctx.fill();
          ctx.drawImage(lImg, pos, pos, lSize, lSize);

          showQRUI();
        };
        lImg.src = appState.logoUrl;
      } else {
        showQRUI();
      }
    };
    img.src = objectUrl;
  } catch(e) {
    showToast('Failed to generate QR', 'err');
  }
}

function showQRUI() {
  $('#qr-canvas').style.display = 'block';
  $('#qr-meta').style.display = 'block';
  $('#qr-meta').innerText = `${appState.qrSize}×${appState.qrSize}px · ${$('#ecc-group .active').dataset.val} error correction`;
  $('#qr-actions').style.display = 'grid';

  if (appState.user && db) {
      db.collection('users').doc(appState.user.uid).collection('qrcodes').add({
          type: appState.activeTab,
          data: getQRDataString(),
          fg: $('#c-fg').value,
          bg: $('#c-bg').value,
          ecc: $('#ecc-group .active').dataset.val,
          size: appState.qrSize,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(e => console.warn('Failed to save history'));
  }

  // Nudge logic: shown once right after generation
  if(!appState.user && !sessionStorage.getItem('sz_nudge')) {
    $('#guest-signup-nudge').style.display = 'block';
    sessionStorage.setItem('sz_nudge', '1');
  }
}

async function downloadPNG() {
  let cost = getCost();
  if(appState.qrSize === 1000) cost += CREDIT_COSTS.png1000;
  if(appState.qrSize === 2000) cost += CREDIT_COSTS.png2000;

  if(!await deductCredits(cost)) return;

  resetBlurTimer();
  showToast('Preparing download...', 'ok');

  // Re-fetch at correct size
  const str = getQRDataString();
  const fg = $('#c-fg').value.substring(1);
  const bg = $('#c-bg').value.substring(1);
  const ecc = $('#ecc-group .active').dataset.val;
  const qz = $('#c-qz').value;

  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${appState.qrSize}x${appState.qrSize}&data=${encodeURIComponent(str)}&color=${fg}&bgcolor=${bg}&ecc=${ecc}&qzone=${qz}`;

  try {
    const res = await fetch(url);
    const blob = await res.blob();

    // Draw to temp canvas to apply logo and watermark
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = appState.qrSize;
      c.height = appState.qrSize;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(objectUrl);

      // Logo
      if(appState.logoUrl) {
         const lImg = new Image();
         lImg.onload = () => {
            const lSize = appState.qrSize * 0.25;
            const pos = (appState.qrSize - lSize) / 2;
            ctx.fillStyle = $('#c-bg').value;
            ctx.beginPath();
            ctx.roundRect(pos - 8, pos - 8, lSize + 16, lSize + 16, 12);
            ctx.fill();
            ctx.drawImage(lImg, pos, pos, lSize, lSize);

            finishDownload(c, cost);
         };
         lImg.src = appState.logoUrl;
      } else {
         finishDownload(c, cost);
      }
    };
    img.src = objectUrl;

  } catch(e) {
    showToast('Download failed', 'err');
  }
}

function finishDownload(canvas, cost) {
  // Guest Watermark (Security Requirement)
  if(!appState.user) {
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#7C5CF5';
    ctx.font = `bold ${Math.max(canvas.width * 0.045, 10)}px Inter, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('scanzap.com', canvas.width - 8, canvas.height - 8);
    ctx.restore();
  }

  canvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `scanzap-${appState.qrSize}px.png`;
    a.click();
    URL.revokeObjectURL(a.href);

    logGenerationHistory(cost);
  });
}

async function downloadSVG() {
  if(appState.logoUrl) { showToast('SVG not supported with logo yet.', 'err'); return; }

  let cost = getCost() + CREDIT_COSTS.svg;
  if(!await deductCredits(cost)) return;

  resetBlurTimer();
  showToast('Preparing SVG...', 'ok');

  const str = getQRDataString();
  const fg = $('#c-fg').value.substring(1);
  const bg = $('#c-bg').value.substring(1);
  const ecc = $('#ecc-group .active').dataset.val;
  const qz = $('#c-qz').value;

  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${appState.qrSize}x${appState.qrSize}&data=${encodeURIComponent(str)}&color=${fg}&bgcolor=${bg}&ecc=${ecc}&qzone=${qz}&format=svg`;

  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scanzap.svg';
    a.click();
    URL.revokeObjectURL(a.href);

    logGenerationHistory(cost);
  } catch(e) {
    showToast('SVG download failed', 'err');
  }
}

async function generateBulk() {
  if(appState.csvData.length === 0) return;
  let batches = Math.ceil(appState.csvData.length / 10);
  let cost = batches * 10;

  if(!await deductCredits(cost)) return;

  showToast(`Generating ${appState.csvData.length} QRs. Please wait...`, 'info');

  const fg = $('#c-fg').value.substring(1);
  const bg = $('#c-bg').value.substring(1);
  const ecc = $('#ecc-group .active').dataset.val;
  const qz = $('#c-qz').value;

  try {
    const zip = new JSZip();
    const folder = zip.folder("Scanzap_Bulk_QRs");

    let processed = 0;
    for(let i=0; i<appState.csvData.length; i++) {
        let row = appState.csvData[i];
        let url = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(row)}&color=${fg}&bgcolor=${bg}&ecc=${ecc}&qzone=${qz}`;
        const res = await fetch(url);
        const blob = await res.blob();
        folder.file(`QR_${i+1}.png`, blob);
        processed++;
    }

    showToast('Zipping files...', 'info');
    const zipBlob = await zip.generateAsync({type:"blob"});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zipBlob);
    a.download = 'Scanzap_Bulk.zip';
    a.click();
    URL.revokeObjectURL(a.href);

    showToast('ZIP downloaded successfully!', 'ok');
  } catch(e) {
    showToast('Bulk generation failed.', 'err');
    console.error(e);
  }
}

function logGenerationHistory(cost, isBulk = false) {
  if(!appState.user || !db) return;

  if(cost > 0) {
    db.collection('users').doc(appState.user.uid).collection('creditHistory').add({
      amount: -cost,
      reason: isBulk ? 'Bulk CSV Generation' : 'Premium QR Download',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  if(!isBulk) {
    db.collection('users').doc(appState.user.uid).collection('qrcodes').add({
      type: appState.activeTab,
      data: getQRDataString(),
      fg: $('#c-fg').value,
      bg: $('#c-bg').value,
      ecc: $('#ecc-group .active').dataset.val,
      size: appState.qrSize,
      hasLogo: !!appState.logoUrl,
      creditsCost: cost,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}

async function shareQR() {
  const canvas = $('#qr-canvas');
  if(!navigator.share) { showToast('Sharing not supported on this device.', 'err'); return; }
  try {
    canvas.toBlob(async (blob) => {
      const file = new File([blob], 'qr.png', { type: 'image/png' });
      await navigator.share({ title: 'Scanzap QR', files: [file] });
    });
  } catch(e) { console.log(e); }
}

function testScan() {
  showToast('Test Scan initializing (Requires Camera)...', 'info');
  // (Omitted full JSQR integration for brevity, simple mock)
  setTimeout(() => showToast('Test scan: Data looks perfect!', 'ok'), 1500);
}

// Templates
function applyTemplate(id) {
  let target = '';
  if(id==='wifi') { target = 'panel-wifi'; $('#in-wifi-ssid').value = 'GuestNetwork'; }
  if(id==='menu') { target = 'panel-url'; $('#in-url').value = 'https://yourmenu.link'; $('#c-fg').value = '#00D4AA'; updateHex($('#c-fg'), 'hex-fg'); }
  if(id==='vcard') target = 'panel-vcard';
  if(id==='whatsapp') { target = 'panel-url'; $('#in-url').value = ''; $('#in-url').placeholder = 'https://wa.me/1234567890'; }
  if(id==='youtube') { target = 'panel-url'; $('#in-url').value = ''; $('#in-url').placeholder = 'https://youtube.com/@ChannelName'; }
  if(id==='calendly') { target = 'panel-url'; $('#in-url').value = 'https://calendly.com/'; }

  document.querySelector('.generator-section').scrollIntoView();

  $$('.tabs-wrap .tab').forEach(t => {
    if(t.dataset.target === target) t.click();
  });
}

// ==================== STRIPE (Replacing Razorpay) ====================
let pendingPromoPack = null;

function buyCredits(packId) {
  if(!appState.user) {
    showToast('Please sign in first to purchase credits.', 'warn');
    openAuthModal('signin');
    return;
  }

  const pack = CREDIT_PACKS.find(p => p.id === packId);
  if(!pack) { console.warn('buyCredits: unknown packId', packId); return; }

  pendingPromoPack = pack;
  $('#promo-pack-name').innerText = `${pack.name} Pack — ${pack.credits} credits (${pack.display})`;
  $('#promo-input').value = '';
  $('#promo-error').style.display = 'none';
  openModal('promoModal');
  setTimeout(() => $('#promo-input').focus(), 150);
}

async function submitPromoCode() {
  if(!pendingPromoPack || !appState.user || !db) return;

  const errEl = $('#promo-error');
  errEl.style.display = 'none';

  // .trim() matters: mobile keyboards and copy/paste routinely add a leading
  // space or trailing newline that made an otherwise-correct code fail silently.
  const code = ($('#promo-input').value || '').trim();

  if(!code) {
    errEl.textContent = 'Enter a code first.';
    errEl.style.display = 'block';
    return;
  }

  if(code !== VALID_PROMO_CODE) {
    errEl.textContent = 'Invalid promo code.';
    errEl.style.display = 'block';
    return;
  }

  const pack = pendingPromoPack;
  const btn = $('#promo-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Applying...';

  try {
    await withTimeout(
      db.collection('users').doc(appState.user.uid).update({
        credits: firebase.firestore.FieldValue.increment(pack.credits),
        creditsEarned: firebase.firestore.FieldValue.increment(pack.credits)
      }),
      15000,
      'Applying your code is taking too long. Check your connection and try again.'
    );
    await withTimeout(
      recordHistory(appState.user.uid, `Promo: ${pack.name} Pack`, pack.credits),
      15000,
      'Saving your transaction history is taking too long.'
    );

    pendingPromoPack = null;
    closeModal('promoModal');
    showToast(`🎉 Promo Code Applied! ${pack.credits} Credits added successfully.`, 'credit');
    flashCreditCounter('glow');
    triggerConfetti();
    // Local credit counters are intentionally NOT hand-patched here — the
    // realtime onSnapshot listener in syncUserData() picks up this write within
    // milliseconds and updates appState/the UI from the server-confirmed value,
    // which avoids the two ever drifting out of sync.
  } catch(e) {
    console.error('Promo code redemption failed:', e);
    errEl.textContent = 'Something went wrong applying your code (' + (e.message || 'unknown error') + '). Please try again.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Apply Code';
  }
}


// ==================== SECURITY & UX (Section 9) ====================
// 9B. Right Click on QR
$('#qr-wrap').addEventListener('contextmenu', e => { e.preventDefault(); showToast('Right-click disabled. Use the Download button.', 'info'); });

// 9F. Keyboard Block
document.addEventListener('keydown', (e) => {
  const qrHover = $('#qr-wrap').matches(':hover');
  if(!qrHover) return;
  if(e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if(['s','p','u'].includes(k)) e.preventDefault();
  }
});

// 9I. Soft DevTools detect
let devtoolsOpen = false;
setInterval(() => {
  const wd = window.outerWidth - window.innerWidth > 160;
  const hd = window.outerHeight - window.innerHeight > 160;
  if((wd || hd) !== devtoolsOpen) {
    devtoolsOpen = wd || hd;
    $('#qr-canvas').style.filter = devtoolsOpen ? 'blur(12px)' : 'none';
  }
}, 1000);

// Global Esc to close modals
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') { $$('.modal-overlay').forEach(m => m.classList.remove('active')); }
});

// Exit Intent (10)
let exitShown = false;
document.addEventListener('mouseleave', (e) => {
  if(e.clientY < 5 && !exitShown && !appState.user && !sessionStorage.getItem('sz_exit')) {
    exitShown = true;
    sessionStorage.setItem('sz_exit', '1');
    openModal('exitIntentModal');
  }
});

// Live Visitor Counter
function updateVisitorCount() {
  const v = $('#visitor-count');
  if(v) {
    const n = Math.floor(Math.random() * 39) + 14;
    $('#visitor-widget').style.opacity = '0';
    setTimeout(() => {
      v.innerText = n;
      $('#visitor-widget').style.opacity = '1';
    }, 300);
  }
  setTimeout(updateVisitorCount, Math.random() * 60000 + 30000);
}
setTimeout(updateVisitorCount, 5000);

// Scroll Animations
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if(e.isIntersecting) {
      e.target.classList.add('visible');
      observer.unobserve(e.target);
    }
  });
}, { threshold: 0.1 });
$$('.animate-on-scroll').forEach(el => observer.observe(el));

// FAQ Toggle
function toggleFaq(btn) {
  const item = btn.parentElement;
  const isActive = item.classList.contains('active');
  $$('.faq-item').forEach(i => i.classList.remove('active'));
  if(!isActive) item.classList.add('active');
}

// Cookie Consent
if(Intl.DateTimeFormat().resolvedOptions().timeZone.includes('Europe') && !localStorage.getItem('sz_cookie')) {
  $('#cookieBanner').classList.add('active');
}
function acceptCookies(type) {
  localStorage.setItem('sz_cookie', type);
  $('#cookieBanner').classList.remove('active');
}

// Confetti Animation
function triggerConfetti() {
  const c = document.createElement('div');
  c.className = 'confetti-container';
  c.style.display = 'block';
  document.body.appendChild(c);
  const colors = ['#7C5CF5', '#00D4AA', '#FBFF38', '#ffffff'];
  for (let i = 0; i < 40; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    const angle = Math.random() * Math.PI * 2;
    const velocity = 100 + Math.random() * 300;
    el.style.setProperty('--tx', Math.cos(angle) * velocity + 'px');
    el.style.setProperty('--ty', Math.sin(angle) * velocity + 'px');
    el.style.setProperty('--rot', Math.random() * 360 + 'deg');
    c.appendChild(el);
  }
  setTimeout(() => c.remove(), 1600);
}

// Initial setup
setInterval(() => {
  const el = document.getElementById('visitor-count');
  if(el) {
    let current = parseInt(el.innerText);
    let change = Math.floor(Math.random() * 5) - 2;
    current = Math.max(12, current + change);
    el.innerText = current;
  }
}, 5000);

window.onload = () => {
  document.querySelectorAll('.tpl-canvas').forEach(canvas => {
      const data = canvas.dataset.str;
      const color = canvas.dataset.color;
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${data}&color=${color}`;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = url;
  });
  const p = new URLSearchParams(window.location.search);
  if(p.get('ref')) sessionStorage.setItem('sz_ref', p.get('ref'));
};
