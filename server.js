import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } // allows public access
});

const PORT = process.env.PORT || 3000;

// Serve the client
app.use(express.static("public"));

const CELL = 32, COLS = 21, ROWS = 21;

// ====== Maze Generator ======
function generateMaze(cols, rows) {
  const grid = Array(rows).fill(0).map(() => Array(cols).fill(1));
  const dirs = [[0, -2], [2, 0], [0, 2], [-2, 0]];
  const shuffle = a => { for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
  const inBounds = (x,y) => x>0 && x<cols-1 && y>0 && y<rows-1;
  function carve(x, y){
    grid[y][x] = 0;
    shuffle(dirs);
    for (const [dx, dy] of dirs){
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && grid[ny][nx] === 1){
        grid[y + dy/2][x + dx/2] = 0;
        carve(nx, ny);
      }
    }
  }
  carve(1,1);
  grid[Math.floor(rows/2)][Math.floor(cols/2)] = 0;
  return grid;
}

let maze = generateMaze(COLS, ROWS);
const players = {};
let chest = { col: Math.floor(COLS/2), row: Math.floor(ROWS/2) };
let gameActive = true;

function spawnPlayer(){
  for (let i=0;i<100;i++){
    const c = Math.floor(Math.random()*COLS);
    const r = Math.floor(Math.random()*ROWS);
    if (maze[r] && maze[r][c]===0 && Math.hypot(c-chest.col,r-chest.row)>6)
      return { x:c*CELL+CELL/2, y:r*CELL+CELL/2 };
  }
  return { x:CELL, y:CELL };
}

// ====== SOCKET EVENTS ======
io.on("connection", socket => {
  const id = socket.id;
  const spawn = spawnPlayer();
  const color = '#' + Math.floor(Math.random()*0xFFFFFF).toString(16).padStart(6,'0');
  players[id] = { id, name:"Player", x:spawn.x, y:spawn.y, input:{}, color, speed:120 };

  socket.emit("init", { id, maze, chest, players, cols:COLS, rows:ROWS, cell:CELL });
  socket.broadcast.emit("playerJoined", players[id]);

  socket.on("setName", name => { players[id].name = String(name).slice(0,20); io.emit("players", players); });
  socket.on("input", state => { players[id].input = state; });

  socket.on("disconnect", () => { delete players[id]; io.emit("playerLeft", id); });
});

// ====== GAME LOOP ======
let last = Date.now();
setInterval(()=>{
  const now = Date.now(), dt=(now-last)/1000; last=now;
  for (const id in players){
    const p = players[id];
    let vx=0, vy=0;
    if (p.input.up) vy-=1;
    if (p.input.down) vy+=1;
    if (p.input.left) vx-=1;
    if (p.input.right) vx+=1;
    if (vx||vy){ const len=Math.hypot(vx,vy); vx/=len; vy/=len; }
    const nx = p.x + vx*p.speed*dt, ny = p.y + vy*p.speed*dt;
    const col = Math.floor(nx/CELL), row = Math.floor(ny/CELL);
    if (maze[row] && maze[row][col]===0){ p.x=nx; p.y=ny; }
    if (col===chest.col && row===chest.row && gameActive){
      gameActive=false;
      io.emit("chestTaken", { by:id, name:p.name });
      setTimeout(()=>{
        maze = generateMaze(COLS, ROWS);
        chest = { col:Math.floor(COLS/2), row:Math.floor(ROWS/2) };
        for (const pid in players){
          const s = spawnPlayer(); players[pid].x=s.x; players[pid].y=s.y;
        }
        gameActive=true;
        io.emit("mazeReset",{maze,chest,players});
      },3500);
    }
  }
  io.emit("state", players);
}, 1000/20);

server.listen(PORT, ()=> console.log(`🌐 Public Maze server running on port ${PORT}`));
