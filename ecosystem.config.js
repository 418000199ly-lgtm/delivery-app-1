module.exports = {
  apps: [
    {
      name: 'daijia-app',
      script: './server.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
