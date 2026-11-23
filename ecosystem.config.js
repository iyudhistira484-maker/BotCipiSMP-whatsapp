/**
 * Konfigurasi PM2 Production (24/7) untuk VPS
 * Jalankan dengan:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'cipismp-wa-bot',
      script: './index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '650M',
      restart_delay: 4000,
      exp_backoff_restart_delay: 500,
      kill_timeout: 8000,
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Jakarta',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
