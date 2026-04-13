const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const { marked } = require('marked');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Directories
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
['images', 'audio', 'video'].forEach(sub => {
  fs.mkdirSync(path.join(UPLOAD_DIR, sub), { recursive: true });
});
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Multer setup
// ---------------------------------------------------------------------------
const allowedExt = {
  images: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a'],
  video: ['.mp4', '.webm', '.mov'],
};
const allAllowed = [...allowedExt.images, ...allowedExt.audio, ...allowedExt.video];

function fileCategory(ext) {
  if (allowedExt.images.includes(ext)) return 'images';
  if (allowedExt.audio.includes(ext)) return 'audio';
  if (allowedExt.video.includes(ext)) return 'video';
  return null;
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const cat = fileCategory(ext) || 'images';
    cb(null, path.join(UPLOAD_DIR, cat));
  },
  filename(req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname).toLowerCase());
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allAllowed.includes(ext)) return cb(null, true);
    cb(new Error('File type not allowed'));
  },
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

app.use(session({
  secret: process.env.SESSION_SECRET || 'stargazing-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// Make session user available everywhere
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
let db;
const DB_PATH = path.join(DATA_DIR, 'stargazing.db');

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    color TEXT DEFAULT '#ff69b4',
    role TEXT DEFAULT 'member',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    body TEXT,
    post_type TEXT DEFAULT 'text',
    media_url TEXT,
    media_type TEXT,
    embed_html TEXT,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    time TEXT,
    venue TEXT NOT NULL,
    location TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    embed_url TEXT,
    audio_file TEXT,
    cover_art TEXT,
    release_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS gallery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    media_type TEXT NOT NULL,
    caption TEXT,
    date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS mailing_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS about (
    id INTEGER PRIMARY KEY,
    bio TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS member_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    instrument TEXT,
    bio TEXT,
    photo TEXT,
    display_order INTEGER DEFAULT 0
  )`);

  // Seed about row
  const aboutRow = db.exec('SELECT id FROM about WHERE id = 1');
  if (!aboutRow.length) {
    db.run("INSERT INTO about (id, bio) VALUES (1, 'We are **Stargazzing** — a kids punk band from planet Earth! 🚀🎸')");
  }

  // Seed default admin
  const users = db.exec('SELECT id FROM users LIMIT 1');
  if (!users.length) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'stargazing';
    const hash = bcrypt.hashSync(password, 10);
    db.run(
      "INSERT INTO users (username, password_hash, display_name, color, role) VALUES (?, ?, ?, ?, ?)",
      [username, hash, 'Mission Control', '#ff69b4', 'admin']
    );
    console.log(`Default admin created: ${username}`);
  }

  saveDb();
}

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Helper: run a SELECT and return array of objects
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = query(sql, params);
  return rows[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// ---------------------------------------------------------------------------
// Template engine (simple string replacement)
// ---------------------------------------------------------------------------
function readTemplate(name) {
  return fs.readFileSync(path.join(__dirname, 'views', name), 'utf8');
}

function render(templateName, vars = {}) {
  // Convert activePage to individual nav active classes
  if (vars.activePage) {
    const pages = ['home', 'music', 'shows', 'gallery', 'about'];
    pages.forEach(p => {
      const key = 'active' + p.charAt(0).toUpperCase() + p.slice(1);
      vars[key] = vars.activePage === p ? 'active' : '';
    });
  }

  const layout = readTemplate('layout.html');
  const content = readTemplate(templateName);
  let html = layout.replace('{{content}}', content);
  // Replace all {{varName}} placeholders
  for (const [key, val] of Object.entries(vars)) {
    html = html.split(`{{${key}}}`).join(val != null ? String(val) : '');
  }
  // Clean up any remaining placeholders
  html = html.replace(/\{\{[a-zA-Z_]+\}\}/g, '');
  return html;
}

function renderAdmin(templateName, vars = {}) {
  const layout = readTemplate('admin/layout.html');
  const content = readTemplate(templateName);
  let html = layout.replace('{{content}}', content);
  for (const [key, val] of Object.entries(vars)) {
    html = html.split(`{{${key}}}`).join(val != null ? String(val) : '');
  }
  html = html.replace(/\{\{[a-zA-Z_]+\}\}/g, '');
  return html;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  if (!text) return '';
  return marked(text, { breaks: true });
}

// ---------------------------------------------------------------------------
// Embed detection
// ---------------------------------------------------------------------------
function generateEmbed(url) {
  if (!url) return null;
  url = url.trim();

  // Spotify
  const spotifyMatch = url.match(/open\.spotify\.com\/(track|album|playlist|episode)\/([a-zA-Z0-9]+)/);
  if (spotifyMatch) {
    return `<iframe style="border-radius:12px" src="https://open.spotify.com/embed/${spotifyMatch[1]}/${spotifyMatch[2]}" width="100%" height="152" frameBorder="0" allowfullscreen allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
  }

  // Bandcamp
  if (url.includes('bandcamp.com')) {
    return `<div class="embed-link"><a href="${escapeHtml(url)}" target="_blank" rel="noopener">🎵 Listen on Bandcamp</a></div>`;
  }

  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    return `<iframe width="100%" height="315" src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
  }

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) {
    return `<iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}" width="100%" height="315" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
  }

  // TikTok
  const tiktokMatch = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if (tiktokMatch) {
    return `<blockquote class="tiktok-embed" cite="${escapeHtml(url)}" data-video-id="${tiktokMatch[1]}" style="max-width:605px;min-width:325px;"><section></section></blockquote><script async src="https://www.tiktok.com/embed.js"></script>`;
  }

  // Generic link
  return `<div class="embed-link"><a href="${escapeHtml(url)}" target="_blank" rel="noopener">🔗 ${escapeHtml(url)}</a></div>`;
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/admin/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/admin/login');
  if (req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  next();
}

// ---------------------------------------------------------------------------
// PUBLIC ROUTES
// ---------------------------------------------------------------------------

// Home
app.get('/', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const perPage = 10;
  const offset = (page - 1) * perPage;

  const posts = query(`
    SELECT posts.*, users.display_name, users.color
    FROM posts JOIN users ON posts.user_id = users.id
    ORDER BY posts.created_at DESC
    LIMIT ? OFFSET ?
  `, [perPage + 1, offset]);

  const hasMore = posts.length > perPage;
  if (hasMore) posts.pop();

  const postsHtml = posts.map(p => {
    const initial = p.display_name ? p.display_name.charAt(0).toUpperCase() : '?';
    const bodyHtml = renderMarkdown(p.body);
    let mediaHtml = '';
    if (p.embed_html) {
      mediaHtml = `<div class="post-embed">${p.embed_html}</div>`;
    } else if (p.media_url && p.media_type === 'image') {
      mediaHtml = `<div class="post-media"><img src="${escapeHtml(p.media_url)}" alt="Post image" loading="lazy"></div>`;
    } else if (p.media_url && p.media_type === 'audio') {
      mediaHtml = `<div class="post-media"><audio controls src="${escapeHtml(p.media_url)}"></audio></div>`;
    } else if (p.media_url && p.media_type === 'video') {
      mediaHtml = `<div class="post-media"><video controls src="${escapeHtml(p.media_url)}"></video></div>`;
    }

    const tagsHtml = (p.tags || '').split(',').filter(t => t.trim()).map(t =>
      `<span class="tag tag-${escapeHtml(t.trim().toLowerCase())}">${escapeHtml(t.trim())}</span>`
    ).join('');

    const typeColors = { music: 'pink', art: 'gold', video: 'purple', link: 'pink', text: 'muted' };
    const typeClass = typeColors[p.post_type] || 'muted';

    const date = new Date(p.created_at + 'Z');
    const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    return `<article class="post-card">
      <div class="post-header">
        <div class="post-author">
          <span class="avatar" style="background:${escapeHtml(p.color)}">${initial}</span>
          <span class="author-name" style="color:${escapeHtml(p.color)}">${escapeHtml(p.display_name)}</span>
          <span class="post-time">${timeStr}</span>
        </div>
        <span class="post-type-tag type-${typeClass}">${escapeHtml(p.post_type)}</span>
      </div>
      <div class="post-body">${bodyHtml}</div>
      ${mediaHtml}
      ${tagsHtml ? `<div class="post-tags">${tagsHtml}</div>` : ''}
    </article>`;
  }).join('\n');

  // Upcoming shows (next 4)
  const today = new Date().toISOString().slice(0, 10);
  const upcomingShows = query(
    "SELECT * FROM shows WHERE date >= ? ORDER BY date ASC LIMIT 4", [today]
  );

  const showsHtml = upcomingShows.map(s => {
    const d = new Date(s.date + 'T00:00:00');
    const dayNum = d.getDate();
    const monthStr = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    return `<div class="show-card-mini">
      <div class="show-date-big"><span class="show-day">${dayNum}</span><span class="show-month">${monthStr}</span></div>
      <div class="show-info-mini">
        <div class="show-venue">${escapeHtml(s.venue)}</div>
        ${s.time ? `<div class="show-time">${escapeHtml(s.time)}</div>` : ''}
      </div>
    </div>`;
  }).join('\n');

  const paginationHtml = `<div class="pagination">
    ${page > 1 ? `<a href="/?page=${page - 1}" class="btn btn-outline">← Newer</a>` : ''}
    ${hasMore ? `<a href="/?page=${page + 1}" class="btn btn-outline">Older →</a>` : ''}
  </div>`;

  const html = render('home.html', {
    postsHtml,
    showsHtml: showsHtml || '<p class="text-muted">No upcoming shows yet.</p>',
    paginationHtml,
    showsSection: upcomingShows.length ? '' : 'hidden',
    activePage: 'home',
  });
  res.send(html);
});

// Music
app.get('/music', (req, res) => {
  const tracks = query("SELECT * FROM tracks ORDER BY release_date DESC, created_at DESC");
  const tracksHtml = tracks.map(t => {
    let playerHtml = '';
    if (t.embed_url) {
      playerHtml = generateEmbed(t.embed_url) || '';
    } else if (t.audio_file) {
      playerHtml = `<audio controls src="${escapeHtml(t.audio_file)}"></audio>`;
    }
    const coverHtml = t.cover_art ? `<img src="${escapeHtml(t.cover_art)}" alt="${escapeHtml(t.title)}" class="track-cover" loading="lazy">` : '';
    return `<div class="track-card card">
      ${coverHtml}
      <div class="track-info">
        <h3 class="track-title">${escapeHtml(t.title)}</h3>
        ${t.description ? `<p class="track-desc">${escapeHtml(t.description)}</p>` : ''}
        ${t.release_date ? `<p class="track-date text-muted">${escapeHtml(t.release_date)}</p>` : ''}
        ${playerHtml ? `<div class="track-player">${playerHtml}</div>` : ''}
      </div>
    </div>`;
  }).join('\n');

  const html = render('music.html', {
    tracksHtml: tracksHtml || '<p class="text-muted">No music yet — stay tuned!</p>',
    activePage: 'music',
  });
  res.send(html);
});

// Shows
app.get('/shows', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = query("SELECT * FROM shows WHERE date >= ? ORDER BY date ASC", [today]);
  const past = query("SELECT * FROM shows WHERE date < ? ORDER BY date DESC", [today]);

  function showCard(s) {
    const d = new Date(s.date + 'T00:00:00');
    const dayNum = d.getDate();
    const monthStr = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const yearStr = d.getFullYear();
    return `<div class="show-card card">
      <div class="show-date-block">
        <span class="show-day">${dayNum}</span>
        <span class="show-month">${monthStr}</span>
        <span class="show-year">${yearStr}</span>
      </div>
      <div class="show-details">
        <h3 class="show-venue">${escapeHtml(s.venue)}</h3>
        ${s.location ? `<p class="show-location">${escapeHtml(s.location)}</p>` : ''}
        ${s.time ? `<p class="show-time">${escapeHtml(s.time)}</p>` : ''}
        ${s.description ? `<p class="show-desc">${escapeHtml(s.description)}</p>` : ''}
      </div>
    </div>`;
  }

  const upcomingHtml = upcoming.length ? upcoming.map(showCard).join('\n') : '<p class="text-muted">No upcoming shows yet.</p>';
  const pastHtml = past.length ? past.map(showCard).join('\n') : '<p class="text-muted">No past shows.</p>';

  const html = render('shows.html', { upcomingHtml, pastHtml, activePage: 'shows' });
  res.send(html);
});

// Gallery
app.get('/gallery', (req, res) => {
  const items = query("SELECT * FROM gallery ORDER BY date DESC, created_at DESC");
  const itemsHtml = items.map((g, i) => {
    if (g.media_type === 'image') {
      return `<div class="gallery-item" data-index="${i}">
        <img src="${escapeHtml(g.file_path)}" alt="${escapeHtml(g.caption || '')}" loading="lazy">
        ${g.caption ? `<div class="gallery-caption">${escapeHtml(g.caption)}</div>` : ''}
      </div>`;
    } else {
      return `<div class="gallery-item gallery-video">
        <video controls src="${escapeHtml(g.file_path)}"></video>
        ${g.caption ? `<div class="gallery-caption">${escapeHtml(g.caption)}</div>` : ''}
      </div>`;
    }
  }).join('\n');

  const html = render('gallery.html', {
    itemsHtml: itemsHtml || '<p class="text-muted">No photos or videos yet.</p>',
    galleryData: JSON.stringify(items.filter(g => g.media_type === 'image').map(g => ({ src: g.file_path, caption: g.caption || '' }))),
    activePage: 'gallery',
  });
  res.send(html);
});

// About
app.get('/about', (req, res) => {
  const about = queryOne("SELECT * FROM about WHERE id = 1");
  const members = query("SELECT * FROM member_profiles ORDER BY display_order ASC, id ASC");

  const bioHtml = about && about.bio ? renderMarkdown(about.bio) : '';
  const membersHtml = members.map(m => {
    const photoHtml = m.photo
      ? `<img src="${escapeHtml(m.photo)}" alt="${escapeHtml(m.name)}" class="member-photo">`
      : `<div class="member-photo-placeholder">${m.name.charAt(0).toUpperCase()}</div>`;
    return `<div class="member-card card">
      ${photoHtml}
      <h3 class="member-name">${escapeHtml(m.name)}</h3>
      ${m.instrument ? `<p class="member-instrument">${escapeHtml(m.instrument)}</p>` : ''}
      ${m.bio ? `<p class="member-bio">${escapeHtml(m.bio)}</p>` : ''}
    </div>`;
  }).join('\n');

  const html = render('about.html', { bioHtml, membersHtml, activePage: 'about' });
  res.send(html);
});

// Mailing list signup
app.post('/api/mailing-list', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  try {
    run("INSERT OR IGNORE INTO mailing_list (email) VALUES (?)", [email]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true }); // ignore duplicates
  }
});

// ---------------------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------------------
app.get('/admin/login', (req, res) => {
  let html = readTemplate('admin/login.html');
  html = html.replace('{{errorHtml}}', '');
  res.send(html);
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const user = queryOne("SELECT * FROM users WHERE username = ?", [username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    let html = readTemplate('admin/login.html');
    html = html.replace('{{errorHtml}}', '<p class="login-error">Invalid username or password</p>');
    return res.send(html);
  }
  req.session.user = { id: user.id, username: user.username, display_name: user.display_name, color: user.color, role: user.role };
  res.redirect('/admin');
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ---------------------------------------------------------------------------
// ADMIN ROUTES
// ---------------------------------------------------------------------------
app.get('/admin', requireAuth, (req, res) => {
  const recentPosts = query(`
    SELECT posts.*, users.display_name FROM posts
    JOIN users ON posts.user_id = users.id
    ORDER BY posts.created_at DESC LIMIT 10
  `);

  const postsHtml = recentPosts.map(p => `<tr>
    <td>${escapeHtml(p.display_name)}</td>
    <td>${escapeHtml(p.post_type)}</td>
    <td>${escapeHtml((p.body || '').substring(0, 60))}${(p.body || '').length > 60 ? '…' : ''}</td>
    <td>${new Date(p.created_at + 'Z').toLocaleDateString()}</td>
    <td>
      <a href="/admin/posts/${p.id}/edit" class="btn btn-sm">Edit</a>
      <form method="POST" action="/admin/posts/${p.id}/delete" style="display:inline" onsubmit="return confirm('Delete?')">
        <button type="submit" class="btn btn-sm btn-danger">Delete</button>
      </form>
    </td>
  </tr>`).join('\n');

  const html = renderAdmin('admin/dashboard.html', {
    postsHtml,
    userName: escapeHtml(req.session.user.display_name),
  });
  res.send(html);
});

// --- Posts ---
app.get('/admin/posts/new', requireAuth, (req, res) => {
  const html = renderAdmin('admin/post-form.html', {
    formAction: '/admin/posts',
    formTitle: 'New Post',
    body: '', postType: 'text', mediaUrl: '', tags: '',
    postTypeText: 'selected', postTypeMusic: '', postTypeArt: '', postTypeVideo: '', postTypeLink: '',
  });
  res.send(html);
});

app.post('/admin/posts', requireAuth, upload.single('media'), (req, res) => {
  const { body, post_type, embed_url, tags } = req.body;
  let mediaUrl = null, mediaType = null, embedHtml = null;

  if (req.file) {
    const ext = path.extname(req.file.originalname).toLowerCase();
    const cat = fileCategory(ext);
    mediaUrl = `/uploads/${cat}/${req.file.filename}`;
    mediaType = cat === 'images' ? 'image' : cat === 'audio' ? 'audio' : 'video';
  } else if (embed_url && embed_url.trim()) {
    mediaUrl = embed_url.trim();
    mediaType = 'embed';
    embedHtml = generateEmbed(embed_url.trim());
  }

  run(
    "INSERT INTO posts (user_id, body, post_type, media_url, media_type, embed_html, tags) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [req.session.user.id, body, post_type || 'text', mediaUrl, mediaType, embedHtml, tags]
  );
  res.redirect('/admin');
});

app.get('/admin/posts/:id/edit', requireAuth, (req, res) => {
  const post = queryOne("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).send('Not found');
  if (req.session.user.role !== 'admin' && post.user_id !== req.session.user.id) return res.status(403).send('Forbidden');

  const types = ['text', 'music', 'art', 'video', 'link'];
  const typeVars = {};
  types.forEach(t => { typeVars[`postType${t.charAt(0).toUpperCase() + t.slice(1)}`] = post.post_type === t ? 'selected' : ''; });

  const html = renderAdmin('admin/post-form.html', {
    formAction: `/admin/posts/${post.id}`,
    formTitle: 'Edit Post',
    body: escapeHtml(post.body || ''),
    mediaUrl: escapeHtml(post.media_url || ''),
    tags: escapeHtml(post.tags || ''),
    ...typeVars,
  });
  res.send(html);
});

app.post('/admin/posts/:id', requireAuth, upload.single('media'), (req, res) => {
  const post = queryOne("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).send('Not found');
  if (req.session.user.role !== 'admin' && post.user_id !== req.session.user.id) return res.status(403).send('Forbidden');

  const { body, post_type, embed_url, tags } = req.body;
  let mediaUrl = post.media_url, mediaType = post.media_type, embedHtml = post.embed_html;

  if (req.file) {
    const ext = path.extname(req.file.originalname).toLowerCase();
    const cat = fileCategory(ext);
    mediaUrl = `/uploads/${cat}/${req.file.filename}`;
    mediaType = cat === 'images' ? 'image' : cat === 'audio' ? 'audio' : 'video';
    embedHtml = null;
  } else if (embed_url && embed_url.trim()) {
    mediaUrl = embed_url.trim();
    mediaType = 'embed';
    embedHtml = generateEmbed(embed_url.trim());
  }

  run(
    "UPDATE posts SET body = ?, post_type = ?, media_url = ?, media_type = ?, embed_html = ?, tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [body, post_type || 'text', mediaUrl, mediaType, embedHtml, tags, req.params.id]
  );
  res.redirect('/admin');
});

app.post('/admin/posts/:id/delete', requireAuth, (req, res) => {
  const post = queryOne("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).send('Not found');
  if (req.session.user.role !== 'admin' && post.user_id !== req.session.user.id) return res.status(403).send('Forbidden');
  run("DELETE FROM posts WHERE id = ?", [req.params.id]);
  res.redirect('/admin');
});

// --- Shows ---
app.get('/admin/shows', requireAuth, (req, res) => {
  const shows = query("SELECT * FROM shows ORDER BY date DESC");
  const showsHtml = shows.map(s => `<tr>
    <td>${escapeHtml(s.date)}</td>
    <td>${escapeHtml(s.venue)}</td>
    <td>${escapeHtml(s.location || '')}</td>
    <td>
      <a href="/admin/shows/${s.id}/edit" class="btn btn-sm">Edit</a>
      <form method="POST" action="/admin/shows/${s.id}/delete" style="display:inline" onsubmit="return confirm('Delete?')">
        <button type="submit" class="btn btn-sm btn-danger">Delete</button>
      </form>
    </td>
  </tr>`).join('\n');

  const html = renderAdmin('admin/show-list.html', { showsHtml });
  res.send(html);
});

app.get('/admin/shows/new', requireAuth, (req, res) => {
  const html = renderAdmin('admin/show-form.html', {
    formAction: '/admin/shows',
    formTitle: 'New Show',
    date: '', time: '', venue: '', location: '', description: '',
  });
  res.send(html);
});

app.post('/admin/shows', requireAuth, (req, res) => {
  const { date, time, venue, location, description } = req.body;
  run("INSERT INTO shows (date, time, venue, location, description) VALUES (?, ?, ?, ?, ?)",
    [date, time, venue, location, description]);
  res.redirect('/admin/shows');
});

app.get('/admin/shows/:id/edit', requireAuth, (req, res) => {
  const show = queryOne("SELECT * FROM shows WHERE id = ?", [req.params.id]);
  if (!show) return res.status(404).send('Not found');
  const html = renderAdmin('admin/show-form.html', {
    formAction: `/admin/shows/${show.id}`,
    formTitle: 'Edit Show',
    date: show.date || '', time: show.time || '', venue: escapeHtml(show.venue),
    location: escapeHtml(show.location || ''), description: escapeHtml(show.description || ''),
  });
  res.send(html);
});

app.post('/admin/shows/:id', requireAuth, (req, res) => {
  const { date, time, venue, location, description } = req.body;
  run("UPDATE shows SET date = ?, time = ?, venue = ?, location = ?, description = ? WHERE id = ?",
    [date, time, venue, location, description, req.params.id]);
  res.redirect('/admin/shows');
});

app.post('/admin/shows/:id/delete', requireAuth, (req, res) => {
  run("DELETE FROM shows WHERE id = ?", [req.params.id]);
  res.redirect('/admin/shows');
});

// --- Tracks ---
app.get('/admin/music', requireAuth, (req, res) => {
  const tracks = query("SELECT * FROM tracks ORDER BY release_date DESC, created_at DESC");
  const tracksHtml = tracks.map(t => `<tr>
    <td>${escapeHtml(t.title)}</td>
    <td>${escapeHtml(t.release_date || '')}</td>
    <td>
      <a href="/admin/music/${t.id}/edit" class="btn btn-sm">Edit</a>
      <form method="POST" action="/admin/music/${t.id}/delete" style="display:inline" onsubmit="return confirm('Delete?')">
        <button type="submit" class="btn btn-sm btn-danger">Delete</button>
      </form>
    </td>
  </tr>`).join('\n');

  const html = renderAdmin('admin/track-list.html', { tracksHtml });
  res.send(html);
});

app.get('/admin/music/new', requireAuth, (req, res) => {
  const html = renderAdmin('admin/track-form.html', {
    formAction: '/admin/music',
    formTitle: 'New Track',
    title: '', description: '', embedUrl: '', releaseDate: '',
  });
  res.send(html);
});

app.post('/admin/music', requireAuth, upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
]), (req, res) => {
  const { title, description, embed_url, release_date } = req.body;
  let audioFile = null, coverArt = null;
  if (req.files && req.files.audio && req.files.audio[0]) {
    audioFile = `/uploads/audio/${req.files.audio[0].filename}`;
  }
  if (req.files && req.files.cover && req.files.cover[0]) {
    coverArt = `/uploads/images/${req.files.cover[0].filename}`;
  }
  run("INSERT INTO tracks (title, description, embed_url, audio_file, cover_art, release_date) VALUES (?, ?, ?, ?, ?, ?)",
    [title, description, embed_url || null, audioFile, coverArt, release_date || null]);
  res.redirect('/admin/music');
});

app.get('/admin/music/:id/edit', requireAuth, (req, res) => {
  const track = queryOne("SELECT * FROM tracks WHERE id = ?", [req.params.id]);
  if (!track) return res.status(404).send('Not found');
  const html = renderAdmin('admin/track-form.html', {
    formAction: `/admin/music/${track.id}`,
    formTitle: 'Edit Track',
    title: escapeHtml(track.title), description: escapeHtml(track.description || ''),
    embedUrl: escapeHtml(track.embed_url || ''), releaseDate: track.release_date || '',
  });
  res.send(html);
});

app.post('/admin/music/:id', requireAuth, upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
]), (req, res) => {
  const track = queryOne("SELECT * FROM tracks WHERE id = ?", [req.params.id]);
  if (!track) return res.status(404).send('Not found');
  const { title, description, embed_url, release_date } = req.body;
  let audioFile = track.audio_file, coverArt = track.cover_art;
  if (req.files && req.files.audio && req.files.audio[0]) {
    audioFile = `/uploads/audio/${req.files.audio[0].filename}`;
  }
  if (req.files && req.files.cover && req.files.cover[0]) {
    coverArt = `/uploads/images/${req.files.cover[0].filename}`;
  }
  run("UPDATE tracks SET title = ?, description = ?, embed_url = ?, audio_file = ?, cover_art = ?, release_date = ? WHERE id = ?",
    [title, description, embed_url || null, audioFile, coverArt, release_date || null, req.params.id]);
  res.redirect('/admin/music');
});

app.post('/admin/music/:id/delete', requireAuth, (req, res) => {
  run("DELETE FROM tracks WHERE id = ?", [req.params.id]);
  res.redirect('/admin/music');
});

// --- Gallery ---
app.get('/admin/gallery', requireAuth, (req, res) => {
  const items = query("SELECT * FROM gallery ORDER BY created_at DESC");
  const itemsHtml = items.map(g => `<div class="admin-gallery-item">
    ${g.media_type === 'image'
      ? `<img src="${escapeHtml(g.file_path)}" alt="${escapeHtml(g.caption || '')}">`
      : `<video src="${escapeHtml(g.file_path)}" muted></video>`}
    <div class="admin-gallery-meta">
      <p>${escapeHtml(g.caption || 'No caption')}</p>
      <form method="POST" action="/admin/gallery/${g.id}/delete" onsubmit="return confirm('Delete?')">
        <button type="submit" class="btn btn-sm btn-danger">Delete</button>
      </form>
    </div>
  </div>`).join('\n');

  const html = renderAdmin('admin/gallery-manage.html', { itemsHtml });
  res.send(html);
});

app.get('/admin/gallery/new', requireAuth, (req, res) => {
  const html = renderAdmin('admin/gallery-form.html', {});
  res.send(html);
});

app.post('/admin/gallery', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.redirect('/admin/gallery/new');
  const ext = path.extname(req.file.originalname).toLowerCase();
  const cat = fileCategory(ext);
  const filePath = `/uploads/${cat}/${req.file.filename}`;
  const mediaType = cat === 'images' ? 'image' : 'video';
  run("INSERT INTO gallery (file_path, media_type, caption, date) VALUES (?, ?, ?, ?)",
    [filePath, mediaType, req.body.caption || null, req.body.date || null]);
  res.redirect('/admin/gallery');
});

app.post('/admin/gallery/:id/delete', requireAuth, (req, res) => {
  run("DELETE FROM gallery WHERE id = ?", [req.params.id]);
  res.redirect('/admin/gallery');
});

// --- About ---
app.get('/admin/about', requireAuth, (req, res) => {
  const about = queryOne("SELECT * FROM about WHERE id = 1");
  const html = renderAdmin('admin/about-form.html', {
    bio: escapeHtml(about ? about.bio || '' : ''),
  });
  res.send(html);
});

app.post('/admin/about', requireAuth, (req, res) => {
  run("UPDATE about SET bio = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1", [req.body.bio]);
  res.redirect('/admin/about');
});

// --- Member Profiles ---
app.get('/admin/profiles', requireAuth, (req, res) => {
  const members = query("SELECT * FROM member_profiles ORDER BY display_order ASC, id ASC");
  const membersHtml = members.map(m => `<tr>
    <td>${escapeHtml(m.name)}</td>
    <td>${escapeHtml(m.instrument || '')}</td>
    <td>${m.display_order}</td>
    <td>
      <a href="/admin/profiles/${m.id}/edit" class="btn btn-sm">Edit</a>
      <form method="POST" action="/admin/profiles/${m.id}/delete" style="display:inline" onsubmit="return confirm('Delete?')">
        <button type="submit" class="btn btn-sm btn-danger">Delete</button>
      </form>
    </td>
  </tr>`).join('\n');

  const html = renderAdmin('admin/profile-list.html', { membersHtml });
  res.send(html);
});

app.get('/admin/profiles/new', requireAuth, (req, res) => {
  const html = renderAdmin('admin/profile-form.html', {
    formAction: '/admin/profiles',
    formTitle: 'New Member Profile',
    name: '', instrument: '', bio: '', displayOrder: '0',
  });
  res.send(html);
});

app.post('/admin/profiles', requireAuth, upload.single('photo'), (req, res) => {
  const { name, instrument, bio, display_order } = req.body;
  let photo = null;
  if (req.file) photo = `/uploads/images/${req.file.filename}`;
  run("INSERT INTO member_profiles (name, instrument, bio, photo, display_order) VALUES (?, ?, ?, ?, ?)",
    [name, instrument, bio, photo, parseInt(display_order) || 0]);
  res.redirect('/admin/profiles');
});

app.get('/admin/profiles/:id/edit', requireAuth, (req, res) => {
  const m = queryOne("SELECT * FROM member_profiles WHERE id = ?", [req.params.id]);
  if (!m) return res.status(404).send('Not found');
  const html = renderAdmin('admin/profile-form.html', {
    formAction: `/admin/profiles/${m.id}`,
    formTitle: 'Edit Member Profile',
    name: escapeHtml(m.name), instrument: escapeHtml(m.instrument || ''),
    bio: escapeHtml(m.bio || ''), displayOrder: m.display_order || 0,
  });
  res.send(html);
});

app.post('/admin/profiles/:id', requireAuth, upload.single('photo'), (req, res) => {
  const m = queryOne("SELECT * FROM member_profiles WHERE id = ?", [req.params.id]);
  if (!m) return res.status(404).send('Not found');
  const { name, instrument, bio, display_order } = req.body;
  let photo = m.photo;
  if (req.file) photo = `/uploads/images/${req.file.filename}`;
  run("UPDATE member_profiles SET name = ?, instrument = ?, bio = ?, photo = ?, display_order = ? WHERE id = ?",
    [name, instrument, bio, photo, parseInt(display_order) || 0, req.params.id]);
  res.redirect('/admin/profiles');
});

app.post('/admin/profiles/:id/delete', requireAuth, (req, res) => {
  run("DELETE FROM member_profiles WHERE id = ?", [req.params.id]);
  res.redirect('/admin/profiles');
});

// --- Mailing List ---
app.get('/admin/mailing-list', requireAuth, (req, res) => {
  const emails = query("SELECT * FROM mailing_list ORDER BY created_at DESC");
  const emailsHtml = emails.map(e => `<tr>
    <td>${escapeHtml(e.email)}</td>
    <td>${new Date(e.created_at + 'Z').toLocaleDateString()}</td>
  </tr>`).join('\n');

  const html = renderAdmin('admin/mailing-list.html', {
    emailsHtml,
    count: emails.length,
  });
  res.send(html);
});

app.get('/admin/mailing-list/export', requireAuth, (req, res) => {
  const emails = query("SELECT email, created_at FROM mailing_list ORDER BY created_at DESC");
  let csv = 'email,signed_up\n';
  emails.forEach(e => { csv += `${e.email},${e.created_at}\n`; });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=mailing-list.csv');
  res.send(csv);
});

// --- Member Accounts (admin only) ---
app.get('/admin/members', requireAdmin, (req, res) => {
  const members = query("SELECT id, username, display_name, color, role, created_at FROM users ORDER BY id ASC");
  const membersHtml = members.map(m => `<tr>
    <td><span class="avatar-sm" style="background:${escapeHtml(m.color)}">${m.display_name.charAt(0).toUpperCase()}</span> ${escapeHtml(m.display_name)}</td>
    <td>${escapeHtml(m.username)}</td>
    <td>${escapeHtml(m.role)}</td>
    <td>
      <a href="/admin/members/${m.id}/edit" class="btn btn-sm">Edit</a>
      ${m.id !== req.session.user.id ? `<form method="POST" action="/admin/members/${m.id}/delete" style="display:inline" onsubmit="return confirm('Delete this member?')">
        <button type="submit" class="btn btn-sm btn-danger">Delete</button>
      </form>` : ''}
    </td>
  </tr>`).join('\n');

  const html = renderAdmin('admin/members.html', { membersHtml });
  res.send(html);
});

app.get('/admin/members/new', requireAdmin, (req, res) => {
  const html = renderAdmin('admin/member-form.html', {
    formAction: '/admin/members',
    formTitle: 'New Member Account',
    username: '', displayName: '', color: '#ff69b4',
    roleAdmin: '', roleMember: 'selected',
  });
  res.send(html);
});

app.post('/admin/members', requireAdmin, (req, res) => {
  const { username, password, display_name, color, role } = req.body;
  if (!username || !password) return res.redirect('/admin/members/new');
  const hash = bcrypt.hashSync(password, 10);
  try {
    run("INSERT INTO users (username, password_hash, display_name, color, role) VALUES (?, ?, ?, ?, ?)",
      [username, hash, display_name || username, color || '#ff69b4', role || 'member']);
  } catch (e) {
    // username taken
  }
  res.redirect('/admin/members');
});

app.get('/admin/members/:id/edit', requireAdmin, (req, res) => {
  const m = queryOne("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!m) return res.status(404).send('Not found');
  const html = renderAdmin('admin/member-form.html', {
    formAction: `/admin/members/${m.id}`,
    formTitle: 'Edit Member Account',
    username: escapeHtml(m.username), displayName: escapeHtml(m.display_name),
    color: m.color, roleAdmin: m.role === 'admin' ? 'selected' : '',
    roleMember: m.role === 'member' ? 'selected' : '',
  });
  res.send(html);
});

app.post('/admin/members/:id', requireAdmin, (req, res) => {
  const { username, password, display_name, color, role } = req.body;
  if (password && password.trim()) {
    const hash = bcrypt.hashSync(password, 10);
    run("UPDATE users SET username = ?, password_hash = ?, display_name = ?, color = ?, role = ? WHERE id = ?",
      [username, hash, display_name, color || '#ff69b4', role || 'member', req.params.id]);
  } else {
    run("UPDATE users SET username = ?, display_name = ?, color = ?, role = ? WHERE id = ?",
      [username, display_name, color || '#ff69b4', role || 'member', req.params.id]);
  }
  // Update session if editing self
  if (parseInt(req.params.id) === req.session.user.id) {
    req.session.user.display_name = display_name;
    req.session.user.color = color;
    req.session.user.role = role;
  }
  res.redirect('/admin/members');
});

app.post('/admin/members/:id/delete', requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) return res.redirect('/admin/members');
  run("DELETE FROM users WHERE id = ?", [req.params.id]);
  res.redirect('/admin/members');
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Stargazzing is live at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
