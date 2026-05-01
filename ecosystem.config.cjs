export default {
  apps: [
    {
      name: "hi-web-talk",
      script: "server/index.js",
      cwd: ".",
      node_args: "",
      env: {
        NODE_ENV: "production",
      },
      instances: "max",
      exec_mode: "cluster",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: "512M",
      kill_timeout: 10000,
      listen_timeout: 5000,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true,
    },
  ],
};
