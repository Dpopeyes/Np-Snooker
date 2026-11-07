@echo off
chcp 65001 >nul
title Np-Snooker Real-time System
start "" "http://localhost:3000"
node server.js
