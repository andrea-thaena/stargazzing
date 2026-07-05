const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const POWERS = path.join(__dirname, 'public', 'powers', 'index.html');

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(POWERS));

// Old band-site and legacy links land on the app
app.use((req, res) => res.redirect('/'));

app.listen(PORT, () => {
  console.log(`Powers Combined is live at http://localhost:${PORT}`);
});
