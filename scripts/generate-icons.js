import { execSync } from 'child_process';

console.log('Running unified mobile asset generator via python3 scripts/generate_mobile_assets.py...');
try {
  execSync('python3 scripts/generate_mobile_assets.py', { stdio: 'inherit' });
  console.log('Mobile assets generated successfully.');
} catch (err) {
  console.error('Failed to generate mobile assets:', err);
  process.exit(1);
}
