const bcrypt = require('bcryptjs');

async function generateHash() {
  const password = 'test123';
  const hash = await bcrypt.hash(password, 10);
  console.log('Correct bcrypt hash for "test123":');
  console.log(hash);
}

generateHash().catch(console.error);
