module.exports = {
  apps: [
    {
      name: "gym-payment-bot",
      script: "./src/index.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_restarts: 10,
      min_uptime: 5000,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
        TZ: "Asia/Kuala_Lumpur",
      },
    },
  ],
};
