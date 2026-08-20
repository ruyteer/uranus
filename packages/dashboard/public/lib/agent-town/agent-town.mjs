const ht = [
  { id: "backlog", name: "Backlog", color: "#95A5A6", buildingStyle: "warehouse" },
  { id: "todo", name: "To Do", color: "#3498DB", buildingStyle: "office" },
  { id: "in_progress", name: "In Progress", color: "#F39C12", buildingStyle: "workshop" },
  { id: "review", name: "Review", color: "#9B59B6", buildingStyle: "lab" },
  { id: "done", name: "Done", color: "#27AE60", buildingStyle: "depot" }
];
function y(x) {
  const i = x.map((t) => t.split("").map(Number));
  return { width: i[0].length, height: i.length, data: i };
}
const Z = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "000333333000",
  "011333333110",
  "011333333110",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), dt = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "000333333000",
  "011333333110",
  "011333333110",
  "000333333000",
  "000044440000",
  "000440044000",
  "000400004000",
  "000500005000",
  "000000000000"
]), ft = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "000333333000",
  "011333333110",
  "011333333110",
  "000333333000",
  "000044440000",
  "000004400000",
  "000004400000",
  "000005500000",
  "000000000000"
]), gt = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "000333333000",
  "000333333000",
  "001333333100",
  "010333333010",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), ut = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "000333333000",
  "000333333000",
  "010333333010",
  "001333333100",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), At = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "000333333000",
  "000333333000",
  "000333333000",
  "001333333100",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), mt = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "000333333000",
  "000333333110",
  "000333331100",
  "000333330000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), bt = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "000333333000",
  "000333333000",
  "000333333110",
  "000333333100",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), kt = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "000333333000",
  "000333333300",
  "000333333310",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), wt = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "100033330001",
  "110333333011",
  "010333333010",
  "000333333000",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), pt = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330010",
  "000333333110",
  "011333333010",
  "011333333000",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), St = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330001",
  "000333333011",
  "011333333000",
  "011333333000",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), Rt = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "100333333000",
  "110333333110",
  "010333333010",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), Ct = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "000333333001",
  "011333333011",
  "010333333000",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), yt = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "000333333100",
  "011333333110",
  "011333333010",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), Mt = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "000333333000",
  "001333333100",
  "001133331100",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000050040000",
  "000050050000"
]), Ft = y([
  "000222222000",
  "002222222200",
  "002111111200",
  "001161161100",
  "001111111100",
  "000111111000",
  "000033330000",
  "000333333000",
  "001333333100",
  "001133331100",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040050000",
  "000050050000"
]), $ = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "022111111220",
  "020033330020",
  "000333333000",
  "011333333110",
  "011333333110",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), Tt = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "022111111220",
  "020033330020",
  "000333333000",
  "011333333110",
  "011333333110",
  "000333333000",
  "000044440000",
  "000440044000",
  "000400004000",
  "000500005000",
  "000000000000"
]), Bt = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "022111111220",
  "020033330020",
  "000333333000",
  "011333333110",
  "011333333110",
  "000333333000",
  "000044440000",
  "000004400000",
  "000004400000",
  "000005500000",
  "000000000000"
]), vt = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "022111111220",
  "020033330020",
  "000333333000",
  "000333333000",
  "001333333100",
  "010333333010",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), Pt = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "022111111220",
  "020033330020",
  "000333333000",
  "000333333000",
  "010333333010",
  "001333333100",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), Et = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "022111111220",
  "020033330020",
  "000333333000",
  "000333333000",
  "000333333000",
  "001333333100",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), _t = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "022111111220",
  "020033330020",
  "000333333000",
  "000333333110",
  "000333331100",
  "000333330000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), Dt = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "022111111220",
  "020033330020",
  "000333333000",
  "000333333000",
  "000333333110",
  "000333333100",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), xt = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "022111111220",
  "020033330020",
  "000333333000",
  "000333333300",
  "000333333310",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), It = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "022111111220",
  "120033330021",
  "110333333011",
  "010333333010",
  "000333333000",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), Wt = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "020111111020",
  "020033330010",
  "000333333110",
  "011333333010",
  "011333333000",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), Ht = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "020111111020",
  "020033330001",
  "000333333011",
  "011333333000",
  "011333333000",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), Ot = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "020111111020",
  "020033330000",
  "100333333000",
  "110333333110",
  "010333333010",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), zt = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "020111111020",
  "020033330000",
  "000333333001",
  "011333333011",
  "010333333000",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), Lt = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "020111111020",
  "020033330000",
  "000333333100",
  "011333333110",
  "011333333010",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040040000",
  "000050050000"
]), Yt = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "020111111020",
  "020033330000",
  "000333333000",
  "001333333100",
  "001133331100",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000050040000",
  "000050050000"
]), Zt = y([
  "000222222000",
  "002222222200",
  "022111111220",
  "021161161120",
  "021111111120",
  "020111111020",
  "020033330000",
  "000333333000",
  "001333333100",
  "001133331100",
  "000333333000",
  "000044440000",
  "000044440000",
  "000040040000",
  "000040050000",
  "000050050000"
]), $t = {
  idle: [Z],
  walk: [dt, Z, ft, Z],
  typing: [gt, ut],
  reading: [At],
  thinking: [Z],
  waiting: [Z],
  success: [Z],
  error: [Z],
  hammering: [mt, bt],
  inspecting: [kt],
  celebrating: [wt],
  waving: [pt, St],
  chatting: [Rt, Ct],
  pointing: [yt],
  carrying: [Mt, Ft]
}, Xt = {
  idle: [$],
  walk: [Tt, $, Bt, $],
  typing: [vt, Pt],
  reading: [Et],
  thinking: [$],
  waiting: [$],
  success: [$],
  error: [$],
  hammering: [_t, Dt],
  inspecting: [xt],
  celebrating: [It],
  waving: [Wt, Ht],
  chatting: [Ot, zt],
  pointing: [Lt],
  carrying: [Yt, Zt]
}, J = [
  { skin: "#FFDCB5", hair: "#3B2417", shirt: "#4A90D9", pants: "#34495E", shoes: "#2C3E50", eyes: "#1A1A2E" },
  { skin: "#F5CBA7", hair: "#C0392B", shirt: "#27AE60", pants: "#2C3E50", shoes: "#1A1A2E", eyes: "#1A1A2E" },
  { skin: "#D4A574", hair: "#1A1A2E", shirt: "#8E44AD", pants: "#34495E", shoes: "#2C3E50", eyes: "#1A1A2E" },
  { skin: "#FFDCB5", hair: "#F39C12", shirt: "#E74C3C", pants: "#2C3E50", shoes: "#34495E", eyes: "#1A1A2E" },
  { skin: "#C68642", hair: "#2C2C2C", shirt: "#F39C12", pants: "#34495E", shoes: "#2C3E50", eyes: "#1A1A2E" },
  { skin: "#FFE0BD", hair: "#6B3FA0", shirt: "#1ABC9C", pants: "#2C3E50", shoes: "#1A1A2E", eyes: "#1A1A2E" },
  { skin: "#E8B796", hair: "#D35400", shirt: "#2980B9", pants: "#34495E", shoes: "#2C3E50", eyes: "#1A1A2E" },
  { skin: "#FFDCB5", hair: "#7F8C8D", shirt: "#E67E22", pants: "#2C3E50", shoes: "#1A1A2E", eyes: "#1A1A2E" },
  { skin: "#A0522D", hair: "#0D0D0D", shirt: "#3498DB", pants: "#2C3E50", shoes: "#1A1A2E", eyes: "#1A1A2E" },
  { skin: "#FFE0BD", hair: "#E74C3C", shirt: "#9B59B6", pants: "#34495E", shoes: "#2C3E50", eyes: "#1A1A2E" },
  { skin: "#FDDBB5", hair: "#DDA520", shirt: "#E84393", pants: "#2D3436", shoes: "#2C3E50", eyes: "#1A1A2E" },
  { skin: "#D2956A", hair: "#2C2C2C", shirt: "#6C5CE7", pants: "#2C3E50", shoes: "#1A1A2E", eyes: "#1A1A2E" },
  { skin: "#FFE0BD", hair: "#A0522D", shirt: "#00B894", pants: "#34495E", shoes: "#2C3E50", eyes: "#1A1A2E" },
  { skin: "#8B6842", hair: "#1A1A1A", shirt: "#FD79A8", pants: "#34495E", shoes: "#2C3E50", eyes: "#1A1A2E" },
  { skin: "#FFDCB5", hair: "#2C2C2C", shirt: "#FDCB6E", pants: "#2C3E50", shoes: "#1A1A2E", eyes: "#1A1A2E" },
  { skin: "#C68642", hair: "#6B3FA0", shirt: "#FF6348", pants: "#2C3E50", shoes: "#2C3E50", eyes: "#1A1A2E" },
  { skin: "#F5CBA7", hair: "#B5651D", shirt: "#5F27CD", pants: "#34495E", shoes: "#2C3E50", eyes: "#1A1A2E" },
  { skin: "#E8B796", hair: "#C0392B", shirt: "#01A3A4", pants: "#2C3E50", shoes: "#1A1A2E", eyes: "#1A1A2E" },
  { skin: "#A0522D", hair: "#2C2C2C", shirt: "#EE5A24", pants: "#2C3E50", shoes: "#1A1A2E", eyes: "#1A1A2E" },
  { skin: "#FFE0BD", hair: "#F39C12", shirt: "#0984E3", pants: "#34495E", shoes: "#2C3E50", eyes: "#1A1A2E" }
], Gt = {
  1: "skin",
  2: "hair",
  3: "shirt",
  4: "pants",
  5: "shoes",
  6: "eyes"
};
function j(x, i, t, s, e, l, n = !1) {
  for (let o = 0; o < i.height; o++)
    for (let a = 0; a < i.width; a++) {
      const r = i.data[o][a];
      if (r === 0) continue;
      const h = Gt[r];
      if (!h) continue;
      x.fillStyle = l[h];
      const c = n ? i.width - 1 - a : a;
      x.fillRect(t + c * e, s + o * e, e, e);
    }
}
let N = 0;
function Q() {
  N = 0;
}
const jt = {
  typing: "coding",
  thinking: "planning",
  waiting: "waiting_approval"
  // These already exist in AgentActivity, so they pass through:
  // idle, reading, success, error
}, X = class X {
  constructor(i, t, s, e = "", l = "") {
    this.path = [], this.pathIndex = 0, this.userStatus = "idle", this.resolvedActivity = "idle", this.isWalking = !1, this.isAtDesk = !1, this.direction = "right", this.animFrame = 0, this.animTimer = 0, this.message = null, this.messageTimer = 0, this.breathPhase = 0, this.blinkTimer = 3 + Math.random() * 3, this.isBlinking = !1, this.blinkDuration = 0, this.currentZoneId = null, this.currentZoneType = null, this.movementTimer = 5 + Math.random() * 8, this.isRoaming = !1, this.socialAction = "none", this.socialTimer = 0, this.socialPartnerId = null, this.coffeeBreakTimer = 30 + Math.random() * 20, this.idleMessageTimer = 5 + Math.random() * 5, this.portalState = "none", this.portalTimer = 0, this.portalDest = null, this.currentObjectiveId = null, this.currentStoryId = null, this.activeTaskCount = 0, this.completedTaskCount = 0, this.skills = [], this.visible = !0, this.walkSpeed = 3, this.walkProgress = 0, this.id = i, this.name = t, this.role = e, this.team = l, this.paletteIndex = N, this.gender = N % 2 === 0 ? "M" : "F", this.palette = J[N++ % J.length], this.gridX = s.x, this.gridY = s.y, this.x = s.x, this.y = s.y;
  }
  /** @deprecated Use currentZoneId instead */
  get workstationId() {
    return this.currentZoneId;
  }
  set workstationId(i) {
    this.currentZoneId = i;
  }
  setStatus(i, t) {
    this.userStatus = i, this.resolvedActivity = jt[i] ?? i, t !== void 0 && (this.message = t, this.messageTimer = t ? 6 : 0);
  }
  walkTo(i) {
    i.length <= 1 || (this.path = i, this.pathIndex = 1, this.isWalking = !0, this.walkProgress = 0);
  }
  portalTo(i) {
    this.portalState = "departing", this.portalTimer = 0, this.portalDest = i, this.isWalking = !1, this.path = [];
  }
  /** Maps resolved activity to one of the sprite animation keys */
  getAnimationKey() {
    if (this.isWalking) return "walk";
    if (this.socialAction !== "none")
      switch (this.socialAction) {
        case "chatting":
          return "chatting";
        case "waving":
          return "waving";
        case "pointing":
          return "pointing";
        case "high_five":
          return "celebrating";
        case "coffee_break":
          return "idle";
        case "stretching":
          return "idle";
        default:
          return "idle";
      }
    switch (this.resolvedActivity) {
      case "coding":
      case "generating":
      case "committing":
      case "pushing":
      case "linting":
        return "typing";
      case "refactoring":
      case "deploying":
        return "hammering";
      case "reading":
      case "searching":
      case "grepping":
        return "reading";
      case "reviewing":
      case "testing":
      case "validating":
        return "inspecting";
      case "planning":
      case "analyzing":
      case "decomposing":
        return "thinking";
      case "waiting_approval":
      case "blocked":
        return "waiting";
      case "success":
        return "celebrating";
      default:
        return "idle";
    }
  }
  update(i) {
    if (this.portalState !== "none") {
      this.portalTimer += i, this.portalState === "departing" ? this.portalTimer >= X.PORTAL_DEPART_TIME && (this.portalDest && (this.x = this.portalDest.x, this.y = this.portalDest.y, this.gridX = this.portalDest.x, this.gridY = this.portalDest.y), this.portalState = "arriving", this.portalTimer = 0) : this.portalState === "arriving" && this.portalTimer >= X.PORTAL_ARRIVE_TIME && (this.portalState = "none", this.portalTimer = 0, this.portalDest = null);
      return;
    }
    this.animTimer += i;
    const t = this.getAnimationKey(), s = this.isWalking ? 0.15 : t === "typing" ? 0.25 : t === "hammering" ? 0.2 : t === "celebrating" ? 0.3 : t === "chatting" ? 0.35 : t === "waving" ? 0.3 : 0.5;
    if (this.animTimer >= s && (this.animTimer -= s, this.animFrame++), this.messageTimer > 0 && (this.messageTimer -= i, this.messageTimer <= 0)) {
      this.messageTimer = 0;
      const o = this.resolvedActivity;
      o !== "waiting_approval" && o !== "error" && o !== "blocked" && (this.message = null);
    }
    if (!this.isWalking && this.isAtDesk ? (this.breathPhase += i * 2.5, this.blinkTimer -= i, this.isBlinking ? (this.blinkDuration -= i, this.blinkDuration <= 0 && (this.isBlinking = !1, this.blinkTimer = 2.5 + Math.random() * 4)) : this.blinkTimer <= 0 && (this.isBlinking = !0, this.blinkDuration = 0.1 + Math.random() * 0.05)) : (this.breathPhase = 0, this.isBlinking = !1, this.blinkTimer = 3), !this.isWalking || this.pathIndex >= this.path.length) return;
    const e = this.path[this.pathIndex], l = e.x - this.gridX, n = e.y - this.gridY;
    this.direction = Math.abs(l) >= Math.abs(n) ? l > 0 ? "right" : "left" : n > 0 ? "down" : "up", this.walkProgress += i * this.walkSpeed, this.walkProgress >= 1 ? (this.gridX = e.x, this.gridY = e.y, this.x = e.x, this.y = e.y, this.walkProgress = 0, this.pathIndex++, this.pathIndex >= this.path.length && (this.isWalking = !1, this.path = [], this.pathIndex = 0)) : (this.x = this.gridX + (e.x - this.gridX) * this.walkProgress, this.y = this.gridY + (e.y - this.gridY) * this.walkProgress);
  }
  getCurrentSprite() {
    const i = this.getAnimationKey(), t = this.gender === "F" ? Xt : $t, s = t[i] ?? t.idle;
    return { frame: s[this.animFrame % s.length], flip: this.direction === "left" };
  }
};
X.PORTAL_DEPART_TIME = 0.6, X.PORTAL_ARRIVE_TIME = 0.5;
let V = X;
const q = {
  casual: {
    bg: "#1a1520",
    floor: "#C4A882",
    floorAlt: "#BFA07A",
    floorGrid: "#B09872",
    wall: "#8B7355",
    wallTop: "#A0896A",
    wallBorder: "#7A6345",
    deskTop: "#B8956A",
    deskEdge: "#8B6914",
    deskLeg: "#A07850",
    monitor: "#2C3E50",
    screenOn: "#7ED321",
    screenOff: "#1A2530",
    chairSeat: "#E67E22",
    chairBack: "#D35400",
    plantLeaf: "#27AE60",
    plantLeafAlt: "#2ECC71",
    plantPot: "#C0392B",
    bookshelf: "#8B4513",
    books: ["#E74C3C", "#3498DB", "#F39C12", "#9B59B6", "#1ABC9C"],
    coffee: "#5D4037",
    couch: "#9B59B6",
    whiteboard: "#ECF0F1",
    cabinet: "#A0896A",
    printer: "#BDC3C7",
    meetingTable: "#B8956A",
    meetingTableEdge: "#8B6914",
    rug: "#E8D5B7",
    waterCooler: "#ECF0F1",
    waterCoolerWater: "#74B9FF"
  },
  business: {
    bg: "#0F1923",
    floor: "#8890A0",
    floorAlt: "#828A98",
    floorGrid: "#7880A0",
    wall: "#3D4F5F",
    wallTop: "#4D5F6F",
    wallBorder: "#2D3F4F",
    deskTop: "#5C5C6C",
    deskEdge: "#3C3C4C",
    deskLeg: "#4C4C5C",
    monitor: "#1C2C3C",
    screenOn: "#4A90D9",
    screenOff: "#1A2530",
    chairSeat: "#2C3E50",
    chairBack: "#1A2530",
    plantLeaf: "#558B6E",
    plantLeafAlt: "#4A7D5E",
    plantPot: "#5C5C5C",
    bookshelf: "#3C3C4C",
    books: ["#4A90D9", "#34495E", "#95A5A6", "#2980B9", "#7F8C8D"],
    coffee: "#4A4A4A",
    couch: "#34495E",
    whiteboard: "#ECF0F1",
    cabinet: "#6C6C7C",
    printer: "#E0E0E0",
    meetingTable: "#4C4C5C",
    meetingTableEdge: "#3C3C4C",
    rug: "#6C7C8C",
    waterCooler: "#D0D0D0",
    waterCoolerWater: "#74B9FF"
  },
  hybrid: {
    bg: "#1a1a2e",
    floor: "#D4C5A0",
    floorAlt: "#CFC09A",
    floorGrid: "#C0B090",
    wall: "#556677",
    wallTop: "#7B8D9E",
    wallBorder: "#445566",
    deskTop: "#A0896A",
    deskEdge: "#6B5335",
    deskLeg: "#8B7355",
    monitor: "#2C3E50",
    screenOn: "#44AACC",
    screenOff: "#1A2530",
    chairSeat: "#8B6243",
    chairBack: "#6B4423",
    plantLeaf: "#27AE60",
    plantLeafAlt: "#2ECC71",
    plantPot: "#8B6243",
    bookshelf: "#6B4423",
    books: ["#E74C3C", "#3498DB", "#F39C12", "#27AE60", "#9B59B6"],
    coffee: "#5D4037",
    couch: "#6B4423",
    whiteboard: "#ECF0F1",
    cabinet: "#7B8D9E",
    printer: "#BDC3C7",
    meetingTable: "#A0896A",
    meetingTableEdge: "#6B5335",
    rug: "#BEB09A",
    waterCooler: "#D0D0D0",
    waterCoolerWater: "#74B9FF"
  }
}, tt = {
  office: q.hybrid,
  rocket: {
    bg: "#08082A",
    floor: "#6A7080",
    floorAlt: "#626870",
    floorGrid: "#5A6068",
    wall: "#4A5060",
    wallTop: "#5A6878",
    wallBorder: "#3A4050",
    deskTop: "#6A7A8A",
    deskEdge: "#4A5A6A",
    deskLeg: "#5A6A7A",
    monitor: "#1A2A3A",
    screenOn: "#44FF88",
    screenOff: "#0A1A1A",
    chairSeat: "#5A6A7A",
    chairBack: "#4A5A6A",
    plantLeaf: "#3A7A4A",
    plantLeafAlt: "#4A8A5A",
    plantPot: "#5A5A5A",
    bookshelf: "#4A5A6A",
    books: ["#E74C3C", "#F39C12", "#ECF0F1", "#3498DB", "#95A5A6"],
    coffee: "#4A4A4A",
    couch: "#4A5A6A",
    whiteboard: "#B0BEC5",
    cabinet: "#5A6A7A",
    printer: "#7A8A9A",
    meetingTable: "#5A6A7A",
    meetingTableEdge: "#4A5A6A",
    rug: "#5A6068",
    waterCooler: "#8A9AAA",
    waterCoolerWater: "#74B9FF"
  },
  space_station: {
    bg: "#030310",
    floor: "#2A3545",
    floorAlt: "#253040",
    floorGrid: "#1E2A38",
    wall: "#1A2535",
    wallTop: "#2A3A4A",
    wallBorder: "#101A28",
    deskTop: "#2A3A4A",
    deskEdge: "#1A2535",
    deskLeg: "#253040",
    monitor: "#0A1520",
    screenOn: "#44AAFF",
    screenOff: "#050A10",
    chairSeat: "#2A3545",
    chairBack: "#1A2535",
    plantLeaf: "#2A6A4A",
    plantLeafAlt: "#3A7A5A",
    plantPot: "#3A3A4A",
    bookshelf: "#1A2535",
    books: ["#4488FF", "#44AAFF", "#2266CC", "#6699FF", "#88BBFF"],
    coffee: "#3A3A4A",
    couch: "#2A3545",
    whiteboard: "#8A9AAA",
    cabinet: "#2A3545",
    printer: "#4A5A6A",
    meetingTable: "#2A3A4A",
    meetingTableEdge: "#1A2535",
    rug: "#253040",
    waterCooler: "#4A5A6A",
    waterCoolerWater: "#44AAFF"
  },
  farm: {
    bg: "#0A1A10",
    floor: "#5B8C3B",
    floorAlt: "#538234",
    floorGrid: "#4A7A2E",
    wall: "#8B6914",
    wallTop: "#9B7924",
    wallBorder: "#7A5A0A",
    deskTop: "#A08050",
    deskEdge: "#806030",
    deskLeg: "#705020",
    monitor: "#5A4020",
    screenOn: "#A0D060",
    screenOff: "#3A2A10",
    chairSeat: "#8B6914",
    chairBack: "#7A5A0A",
    plantLeaf: "#3A8A2A",
    plantLeafAlt: "#4A9A3A",
    plantPot: "#6B4423",
    bookshelf: "#6B4423",
    books: ["#8B6914", "#A08050", "#6B4423", "#C0A060", "#B09040"],
    coffee: "#5A4030",
    couch: "#8B6914",
    whiteboard: "#C0B090",
    cabinet: "#7A5A0A",
    printer: "#A08050",
    meetingTable: "#8B7040",
    meetingTableEdge: "#6B5020",
    rug: "#7A9A50",
    waterCooler: "#A0B0C0",
    waterCoolerWater: "#5ABAFF"
  },
  hospital: {
    bg: "#0A1018",
    floor: "#C0D0C8",
    floorAlt: "#B0C0B8",
    floorGrid: "#A0B0A8",
    wall: "#7A9AB8",
    wallTop: "#8AAAC8",
    wallBorder: "#6A8AA8",
    deskTop: "#C8D0D8",
    deskEdge: "#A0A8B0",
    deskLeg: "#B0B8C0",
    monitor: "#2A3A4A",
    screenOn: "#00BCD4",
    screenOff: "#1A2530",
    chairSeat: "#4A7A9A",
    chairBack: "#3A6A8A",
    plantLeaf: "#4A9A6A",
    plantLeafAlt: "#5AAA7A",
    plantPot: "#8A8A8A",
    bookshelf: "#A0A8B0",
    books: ["#E74C3C", "#3498DB", "#ECF0F1", "#00BCD4", "#FFFFFF"],
    coffee: "#6A6A6A",
    couch: "#4A7A9A",
    whiteboard: "#ECF0F1",
    cabinet: "#D0D8E0",
    printer: "#E0E0E0",
    meetingTable: "#B0B8C0",
    meetingTableEdge: "#8A9AAA",
    rug: "#B0C8B8",
    waterCooler: "#D0D8E0",
    waterCoolerWater: "#74B9FF"
  },
  pirate_ship: {
    bg: "#061020",
    floor: "#8B6914",
    floorAlt: "#7A5A0A",
    floorGrid: "#6A4A00",
    wall: "#5A3A1A",
    wallTop: "#6B4423",
    wallBorder: "#4A2A0A",
    deskTop: "#8B7040",
    deskEdge: "#6B5020",
    deskLeg: "#5A4010",
    monitor: "#3A2A1A",
    screenOn: "#FFCC00",
    screenOff: "#2A1A0A",
    chairSeat: "#6B4423",
    chairBack: "#5A3A1A",
    plantLeaf: "#2A6A3A",
    plantLeafAlt: "#3A7A4A",
    plantPot: "#5A3A1A",
    bookshelf: "#5A3A1A",
    books: ["#CC3333", "#FFCC00", "#ECF0F1", "#1ABC9C", "#8B6914"],
    coffee: "#4A3020",
    couch: "#6B4423",
    whiteboard: "#C0B090",
    cabinet: "#5A3A1A",
    printer: "#7A5A3A",
    meetingTable: "#6B4423",
    meetingTableEdge: "#5A3A1A",
    rug: "#7A6A50",
    waterCooler: "#6A6A7A",
    waterCoolerWater: "#4488CC"
  },
  town: {
    bg: "#0B1A12",
    floor: "#6B8A4A",
    floorAlt: "#5F7E42",
    floorGrid: "#557838",
    wall: "#8B7355",
    wallTop: "#A0896A",
    wallBorder: "#7A6345",
    deskTop: "#A0896A",
    deskEdge: "#7A6345",
    deskLeg: "#5C4A32",
    monitor: "#3A3A4A",
    screenOn: "#4ADE80",
    screenOff: "#1A2A15",
    chairSeat: "#7A6345",
    chairBack: "#6B5535",
    plantLeaf: "#4A7A2A",
    plantLeafAlt: "#3A6A1A",
    plantPot: "#6B4423",
    bookshelf: "#7A6345",
    books: ["#C0392B", "#2980B9", "#27AE60", "#F39C12", "#8E44AD"],
    coffee: "#4A3520",
    couch: "#6B5535",
    whiteboard: "#D0C8B0",
    cabinet: "#7A6345",
    printer: "#5A5A5A",
    meetingTable: "#8B7355",
    meetingTableEdge: "#6B5535",
    rug: "#8B7355",
    waterCooler: "#4A6A8A",
    waterCoolerWater: "#6ABFEF"
  }
}, O = 2, ct = {
  small: { width: 24, height: 13 + O, maxWorkstations: 10, deskStartX: 3, deskColSpacing: 5, deskRowSpacing: 4, deskStartY: 2, deskCols: 4 },
  medium: { width: 30, height: 16 + O, maxWorkstations: 18, deskStartX: 3, deskColSpacing: 5, deskRowSpacing: 4, deskStartY: 2, deskCols: 4 },
  large: { width: 38, height: 20 + O, maxWorkstations: 28, deskStartX: 3, deskColSpacing: 5, deskRowSpacing: 4, deskStartY: 2, deskCols: 6 },
  wide: { width: 46, height: 18 + O, maxWorkstations: 32, deskStartX: 3, deskColSpacing: 5, deskRowSpacing: 4, deskStartY: 2, deskCols: 8 },
  xl: { width: 54, height: 22 + O, maxWorkstations: 40, deskStartX: 3, deskColSpacing: 5, deskRowSpacing: 4, deskStartY: 2, deskCols: 10 }
};
function Nt(x, i, t, s = 16) {
  if (i && t) {
    const e = ["small", "medium", "large", "wide", "xl"];
    let l = "small", n = 0;
    for (const o of e) {
      const a = ct[o];
      if (x > a.maxWorkstations) continue;
      const r = a.width * s, h = a.height * s, c = Math.min((i - 8) / r, (t - 8) / h);
      if (c < 1.5) continue;
      const d = r * c, f = h * c, g = d * f;
      g > n && (n = g, l = o);
    }
    return l;
  }
  return x <= 6 ? "small" : x <= 14 ? "medium" : "large";
}
class qt {
  constructor(i = "small", t = "hybrid", s = "office", e, l) {
    this.gridWidth = 24, this.gridHeight = 16, this.tiles = [], this.zones = [], this.rooms = [], this.spawnPoint = { x: 1, y: 8 }, this.currentEnv = "office", this.ROOF_COLORS = ["building_roof_red", "building_roof_blue", "building_roof_brown", "building_roof_green"], this.rebuild(i, t, s, void 0, l);
  }
  /** @deprecated Use zones instead */
  get workstations() {
    return this.zones;
  }
  rebuild(i, t, s = "office", e, l = ht) {
    const n = ct[i];
    this.gridWidth = n.width, this.gridHeight = n.height, this.tiles = [], this.zones = [], this.rooms = [], this.currentEnv = s, this.spawnPoint = { x: 1, y: Math.floor(this.gridHeight / 2) }, this.initFloor(), this.addWalls(), s === "town" ? this.buildTownRooms(n, l) : this.buildKanbanRooms(n, l);
  }
  /* ── common layout ───────────────────────────── */
  initFloor() {
    for (let i = 0; i < this.gridHeight; i++) {
      this.tiles[i] = [];
      for (let t = 0; t < this.gridWidth; t++)
        this.tiles[i][t] = { type: "floor", walkable: !0 };
    }
  }
  addWalls() {
    for (let i = 0; i < this.gridWidth; i++)
      this.set(i, 0, "wall"), this.set(i, this.gridHeight - 1, "wall");
    for (let i = 0; i < this.gridHeight; i++)
      this.set(0, i, "wall"), this.set(this.gridWidth - 1, i, "wall");
    this.tiles[this.spawnPoint.y][0] = { type: "floor", walkable: !0 };
  }
  /** The Y row where the orchestrator corridor's separator wall sits */
  get orchestratorSeparatorY() {
    return O + 1;
  }
  /** Build the orchestrator/manager corridor at the top of the grid (rows 1..ORCHESTRATOR_ROWS) */
  buildOrchestratorCorridor(i) {
    const t = this.orchestratorSeparatorY, s = 9e3;
    for (let o = 1; o < t; o++)
      for (let a = 1; a < this.gridWidth - 1; a++)
        i === "town" ? this.tiles[o][a] = { type: "town_stairs", walkable: !0 } : this.tiles[o][a] = { type: "floor", walkable: !0 };
    for (let o = 1; o < this.gridWidth - 1; o++)
      this.tiles[t][o] = { type: i === "town" ? "fence" : "wall", walkable: !1 };
    const e = {
      id: s,
      name: "Management",
      bounds: { x: 1, y: 1, w: this.gridWidth - 2, h: O },
      doorways: []
    };
    this.rooms.push(e);
    const l = Math.max(4, Math.floor(this.gridWidth / 5)), n = Math.floor((this.gridWidth - 4) / l);
    for (let o = 0; o < l; o++) {
      const a = 2 + o * n, r = 1 + Math.floor(O / 2);
      a < this.gridWidth - 1 && this.addStandingZone("common_area", { x: a, y: r }, s, "down");
    }
    if (i !== "town") for (let o = 2; o < this.gridWidth - 2; o += 5)
      this.tiles[1][o].type === "floor" && (this.tiles[1][o] = { type: "whiteboard", walkable: !1 });
    return e;
  }
  /** Build a vertical room divider wall with a doorway (below orchestrator corridor) */
  buildRoomDivider(i, t, s = 2) {
    const e = this.orchestratorSeparatorY + 1;
    for (let l = e; l < this.gridHeight - 1; l++)
      l >= t && l < t + s || this.set(i, l, "wall");
  }
  /** Build a horizontal room divider wall with a doorway */
  buildHorizontalDivider(i, t, s = 2, e = 1, l) {
    const n = l ?? this.gridWidth - 1;
    for (let o = e; o < n; o++)
      o >= t && o < t + s || this.set(o, i, "wall");
  }
  /** Create N rooms split by vertical dividers (below the orchestrator corridor) */
  createMultipleRooms(i) {
    const t = i.length, s = t - 1, e = this.gridWidth - 2 - s, l = this.orchestratorSeparatorY + 1, n = this.gridHeight - 1 - l, o = l + Math.floor(n / 2) - 1, a = 2, r = [];
    let h = e;
    for (let f = 0; f < t; f++)
      if (f === t - 1)
        r.push(h);
      else {
        const g = Math.max(3, Math.round(e * i[f].widthFraction));
        r.push(g), h -= g;
      }
    const c = [];
    let d = 1;
    for (let f = 0; f < t; f++) {
      const g = d, u = r[f], b = {
        id: f,
        name: i[f].name,
        bounds: { x: g, y: l, w: u, h: n },
        doorways: []
      };
      if (f > 0)
        for (let A = 0; A < a; A++)
          b.doorways.push({ x: g - 1, y: o + A });
      if (d = g + u, f < t - 1) {
        this.buildRoomDivider(d, o, a);
        for (let A = 0; A < a; A++)
          b.doorways.push({ x: d, y: o + A });
        d++;
      }
      c.push(b);
    }
    return c;
  }
  /* ── zone placement ──────────────────────────── */
  addZone(i, t, s, e = "up") {
    t.x < 1 || t.x >= this.gridWidth - 1 || t.y < 1 || t.y >= this.gridHeight - 1 || this.tiles[t.y][t.x].walkable && this.zones.push({
      id: this.zones.length,
      type: i,
      position: t,
      facingDirection: e,
      roomId: s
    });
  }
  /** Place desk+chair zone */
  addDeskZone(i, t, s, e = "desk") {
    if (i + 1 >= this.gridWidth - 1 || t + 1 >= this.gridHeight - 1 || i < 1 || t < 1 || !this.tiles[t][i].walkable || !this.tiles[t][i + 1].walkable || !this.tiles[t + 1][i].walkable) return !1;
    this.set(i, t, "desk"), this.set(i + 1, t, "desk");
    const l = { x: i, y: t + 1 };
    return this.tiles[l.y][l.x] = { type: "chair", walkable: !0 }, this.addZone(e, l, s, "up"), !0;
  }
  /** Place a standing zone */
  addStandingZone(i, t, s, e = "up") {
    return t.x < 1 || t.x >= this.gridWidth - 1 || t.y < 1 || t.y >= this.gridHeight - 1 || !this.tiles[t.y][t.x].walkable ? !1 : (this.addZone(i, t, s, e), !0);
  }
  /** Fill a room with desk zones in a grid pattern.
   *  When bottomHalfOnly=true, desks are placed only in the lower half of the room. */
  fillDesksInRoom(i, t, s, e = 1, l = !1) {
    let n = 0;
    const o = i.bounds.x, a = o + i.bounds.w, r = i.bounds.y + Math.floor(i.bounds.h / 2), h = l ? r : i.bounds.y + e, c = i.bounds.y + i.bounds.h, d = Math.max(1, Math.floor((a - o) / 3)), f = Math.floor((c - h - 1) / 3);
    for (let g = 0; g < f && n < s; g++)
      for (let u = 0; u < d && n < s; u++) {
        const b = o + u * 3, A = h + g * 3;
        b + 1 < a && A + 1 < c && this.addDeskZone(b, A, i.id, t) && n++;
      }
    return n;
  }
  /* ── office rooms: Planning Area → Dev Floor → Test Lab → Review Corner ── */
  buildOfficeRooms(i) {
    const t = this.createMultipleRooms([
      { name: "Planning Area", widthFraction: 0.2 },
      { name: "Dev Floor", widthFraction: 0.35 },
      { name: "Test Lab", widthFraction: 0.25 },
      { name: "Review Corner", widthFraction: 0.2 }
    ]), [s, e, l, n] = t, o = s.bounds.x + s.bounds.w;
    for (let c = s.bounds.x; c < Math.min(s.bounds.x + 3, o); c++)
      this.tryPlace(c, 1, "whiteboard");
    if (this.addStandingZone("whiteboard_area", { x: s.bounds.x, y: 2 }, s.id, "up"), s.bounds.w > 3 && this.addStandingZone("whiteboard_area", { x: s.bounds.x + 2, y: 2 }, s.id, "up"), this.fillDesksInRoom(s, "planning_board", 4, 2), this.tryPlace(s.bounds.x, this.gridHeight - 2, "plant"), this.tryPlace(o - 1, 1, "bookshelf"), this.gridHeight > 13 && this.tryPlace(o - 1, 2, "bookshelf"), s.bounds.w >= 4 && this.gridHeight > 10) {
      const c = s.bounds.x, d = this.gridHeight - 5;
      d > 3 && (this.tryPlace(c, d, "meeting_table"), c + 1 < o && this.tryPlace(c + 1, d, "meeting_table"), this.addStandingZone("planning_board", { x: c, y: d + 1 }, s.id, "up"), c + 1 < o && this.addStandingZone("planning_board", { x: c + 1, y: d + 1 }, s.id, "up"));
    }
    this.tryPlace(s.bounds.x, this.gridHeight - 3, "cabinet"), this.fillDesksInRoom(e, "coding_desk", Math.ceil(i.maxWorkstations * 0.5)), this.tryPlace(e.bounds.x, 1, "plant");
    const a = e.bounds.x + e.bounds.w;
    this.tryPlace(a - 1, 1, "plant"), this.tryPlace(e.bounds.x, this.gridHeight - 2, "printer"), this.tryPlace(a - 1, this.gridHeight - 2, "cabinet"), this.tryPlace(e.bounds.x + 1, 1, "bookshelf"), e.bounds.w > 6 && this.tryPlace(a - 2, 1, "bookshelf"), this.tryPlace(a - 1, this.gridHeight - 3, "water_cooler"), this.tryPlace(a - 2, this.gridHeight - 2, "couch"), e.bounds.w > 5 && this.tryPlace(e.bounds.x + 2, this.gridHeight - 2, "plant"), this.fillDesksInRoom(l, "test_station", Math.ceil(i.maxWorkstations * 0.25)), this.addStandingZone("ci_monitor", { x: l.bounds.x, y: this.gridHeight - 3 }, l.id, "up"), l.bounds.w > 4 && this.addStandingZone("ci_monitor", { x: l.bounds.x + 3, y: this.gridHeight - 3 }, l.id, "up"), this.tryPlace(l.bounds.x, 1, "cabinet");
    const r = l.bounds.x + l.bounds.w;
    this.tryPlace(r - 1, this.gridHeight - 2, "plant"), this.tryPlace(l.bounds.x + 1, 1, "plant"), this.tryPlace(r - 1, this.gridHeight - 3, "printer"), this.tryPlace(r - 1, 1, "cabinet"), this.fillDesksInRoom(n, "review_desk", Math.ceil(i.maxWorkstations * 0.25));
    const h = n.bounds.x + n.bounds.w;
    this.tryPlace(n.bounds.x, this.gridHeight - 3, "coffee"), n.bounds.w > 3 && this.tryPlace(n.bounds.x + 1, this.gridHeight - 3, "water_cooler"), this.tryPlace(n.bounds.x, this.gridHeight - 4, "couch"), n.bounds.w > 4 && this.tryPlace(n.bounds.x + 1, this.gridHeight - 4, "couch"), n.bounds.w > 5 && this.tryPlace(n.bounds.x + 2, this.gridHeight - 4, "couch");
    for (let c = n.bounds.x; c < Math.min(n.bounds.x + 3, h); c++)
      this.tryPlace(c, this.gridHeight - 2, "rug");
    this.addStandingZone("pair_station", { x: h - 1, y: this.gridHeight - 3 }, n.id, "left"), this.tryPlace(h - 1, 1, "plant"), this.tryPlace(n.bounds.x, 1, "bookshelf"), n.bounds.w > 3 && this.tryPlace(n.bounds.x + 1, 1, "bookshelf"), this.tryPlace(h - 2, this.gridHeight - 2, "plant");
  }
  /* ── rocket rooms: Mission Planning → Assembly Floor → Launch Checks → Control Tower ── */
  buildRocketRooms(i) {
    const t = this.createMultipleRooms([
      { name: "Mission Planning", widthFraction: 0.2 },
      { name: "Assembly Floor", widthFraction: 0.35 },
      { name: "Launch Checks", widthFraction: 0.25 },
      { name: "Control Tower", widthFraction: 0.2 }
    ]), [s, e, l, n] = t, o = s.bounds.x + s.bounds.w;
    for (let f = s.bounds.x; f < Math.min(s.bounds.x + 3, o); f++)
      this.tryPlace(f, 1, "whiteboard");
    this.addStandingZone("planning_board", { x: s.bounds.x, y: 2 }, s.id, "up"), this.fillDesksInRoom(s, "control_panel", 4, 2), this.tryPlace(s.bounds.x, this.gridHeight - 2, "cabinet");
    const a = e.bounds.x + e.bounds.w, r = 2, h = this.gridHeight - 3, c = a - 3;
    if (c > e.bounds.x + 2) {
      this.tryPlace(c, r, "rocket_nose"), this.tryPlace(c + 1, r, "rocket_nose");
      for (let f = r + 1; f < h; f++)
        this.tryPlace(c, f, "rocket_body"), this.tryPlace(c + 1, f, "rocket_body");
      this.tryPlace(c, h, "rocket_engine"), this.tryPlace(c + 1, h, "rocket_engine");
      for (let f = r; f <= h; f++)
        this.tryPlace(c - 1, f, "scaffolding");
      if (c + 2 < a)
        for (let f = r; f <= h; f++)
          this.tryPlace(c + 2, f, "scaffolding");
      for (let f = c - 1; f <= c + 2 && f < a; f++)
        this.tryPlace(f, h + 1, "launch_pad");
      this.tryPlace(c - 2, h, "fuel_tank"), this.tryPlace(c - 2, h - 1, "fuel_tank"), this.addStandingZone("engine_bay", { x: c - 2, y: h }, e.id, "right"), this.addStandingZone("fuselage_work", { x: c - 2, y: r + 1 }, e.id, "right"), this.addStandingZone("fuselage_work", { x: c - 2, y: r + 3 }, e.id, "right"), h - r > 4 && this.addStandingZone("fuselage_work", { x: c - 2, y: Math.floor((r + h) / 2) }, e.id, "right"), this.addStandingZone("fuel_station", { x: c - 3, y: h - 1 }, e.id, "right"), this.addStandingZone("tool_bench", { x: e.bounds.x, y: h }, e.id, "right"), this.addStandingZone("tool_bench", { x: e.bounds.x + 1, y: r + 1 }, e.id, "right");
    }
    this.fillDesksInRoom(e, "tool_bench", 2), this.tryPlace(e.bounds.x, 1, "cabinet"), this.tryPlace(e.bounds.x + 1, 1, "cabinet"), this.fillDesksInRoom(l, "launch_check", 4), this.addStandingZone("ci_monitor", { x: l.bounds.x, y: this.gridHeight - 3 }, l.id, "up"), l.bounds.w > 4 && this.addStandingZone("ci_monitor", { x: l.bounds.x + 3, y: this.gridHeight - 3 }, l.id, "up"), this.addStandingZone("launch_check", { x: l.bounds.x, y: 2 }, l.id, "down"), l.bounds.w > 4 && this.addStandingZone("launch_check", { x: l.bounds.x + 3, y: 2 }, l.id, "down"), this.tryPlace(l.bounds.x, 1, "cabinet"), this.fillDesksInRoom(n, "control_tower", 4), this.tryPlace(n.bounds.x, 1, "comm_dish"), this.addStandingZone("comms", { x: n.bounds.x + 1, y: 2 }, n.id, "left");
    const d = n.bounds.x + n.bounds.w;
    this.tryPlace(d - 1, this.gridHeight - 2, "cabinet");
  }
  /* ── space station rooms: Bridge → Science Lab → Engineering Bay → Comm Center ── */
  buildSpaceStationRooms(i) {
    const t = this.createMultipleRooms([
      { name: "Bridge", widthFraction: 0.2 },
      { name: "Science Lab", widthFraction: 0.35 },
      { name: "Engineering Bay", widthFraction: 0.25 },
      { name: "Comm Center", widthFraction: 0.2 }
    ]), [s, e, l, n] = t, o = s.bounds.x + s.bounds.w;
    for (let c = s.bounds.x; c < o; c++)
      this.tryPlace(c, 1, "hull_window"), this.tryPlace(c, 2, "hull_window");
    for (let c = 3; c < this.gridHeight - 2; c += 3)
      this.tryPlace(1, c, "hull_window");
    this.fillDesksInRoom(s, "bridge_console", 4, 3), this.tryPlace(s.bounds.x, this.gridHeight - 2, "oxygen_tank");
    const a = e.bounds.x + e.bounds.w;
    for (let c = e.bounds.x; c < a; c += 2)
      this.tryPlace(c, 1, "hull_window");
    this.fillDesksInRoom(e, "science_lab", Math.ceil(i.maxWorkstations * 0.4)), this.addStandingZone("engineering", { x: e.bounds.x, y: this.gridHeight - 3 }, e.id, "up"), this.tryPlace(a - 1, this.gridHeight - 2, "sleep_pod"), this.tryPlace(e.bounds.x, this.gridHeight - 2, "sleep_pod");
    const r = l.bounds.x + l.bounds.w;
    this.fillDesksInRoom(l, "test_station", 4), this.addStandingZone("engineering", { x: l.bounds.x, y: this.gridHeight - 3 }, l.id, "up"), l.bounds.w > 4 && this.addStandingZone("engineering", { x: l.bounds.x + 3, y: this.gridHeight - 3 }, l.id, "up"), this.tryPlace(r - 1, 1, "oxygen_tank"), this.tryPlace(l.bounds.x, 1, "solar_panel");
    const h = n.bounds.x + n.bounds.w;
    for (let c = 2; c < this.gridHeight - 2; c += 3)
      this.tryPlace(h - 1, c, "hull_window");
    this.tryPlace(n.bounds.x, 1, "comm_dish"), this.addStandingZone("comms", { x: n.bounds.x + 1, y: 2 }, n.id, "left"), this.fillDesksInRoom(n, "review_desk", 3, 2), this.addStandingZone("observation", { x: h - 2, y: 3 }, n.id, "right"), this.gridHeight > 13 && this.addStandingZone("observation", { x: h - 2, y: 6 }, n.id, "right"), this.tryPlace(h - 1, this.gridHeight - 2, "satellite"), this.tryPlace(n.bounds.x, this.gridHeight - 2, "solar_panel");
  }
  /* ── farm rooms: Planning Shed → Field Work → Harvest Check → Market Stand ── */
  buildFarmRooms(i) {
    const t = this.createMultipleRooms([
      { name: "Planning Shed", widthFraction: 0.2 },
      { name: "Field Work", widthFraction: 0.35 },
      { name: "Harvest Check", widthFraction: 0.25 },
      { name: "Market Stand", widthFraction: 0.2 }
    ]), [s, e, l, n] = t, o = Math.floor(this.gridHeight / 2), a = s.bounds.x + s.bounds.w;
    this.fillDesksInRoom(s, "planning_board", 3), this.tryPlace(s.bounds.x, 1, "hay_bale"), this.tryPlace(a - 1, 1, "hay_bale"), this.tryPlace(s.bounds.x, this.gridHeight - 2, "tree");
    const r = e.bounds.x + e.bounds.w;
    for (let f = e.bounds.x; f < r; f += 2)
      for (let g = 2; g < o; g++)
        this.tryPlace(f, g, "crop");
    for (let f = e.bounds.x + 1; f < r; f += 3)
      this.addStandingZone("crop_field", { x: f, y: 2 }, e.id, "down");
    this.tryPlace(e.bounds.x, o, "tractor"), this.tryPlace(e.bounds.x + 1, o, "tractor"), this.addStandingZone("tractor_seat", { x: e.bounds.x, y: o + 1 }, e.id, "up"), e.bounds.w > 6 && (this.tryPlace(e.bounds.x + 4, o, "tractor"), this.tryPlace(e.bounds.x + 5, o, "tractor"), this.addStandingZone("tractor_seat", { x: e.bounds.x + 4, y: o + 1 }, e.id, "up"));
    const h = o + 2;
    h < this.gridHeight - 2 && (this.tryPlace(e.bounds.x, h, "cow"), this.tryPlace(e.bounds.x + 2, h, "sheep"), this.tryPlace(e.bounds.x + 4, h, "chicken"), this.addStandingZone("animal_pen", { x: e.bounds.x + 1, y: h }, e.id, "left"), this.addStandingZone("animal_pen", { x: e.bounds.x + 3, y: h }, e.id, "left")), h + 2 < this.gridHeight - 1 && (this.tryPlace(e.bounds.x, h + 2, "cow"), this.tryPlace(e.bounds.x + 2, h + 2, "sheep"), this.addStandingZone("animal_pen", { x: e.bounds.x + 3, y: h + 2 }, e.id, "left")), this.tryPlace(r - 1, o + 1, "water_trough"), this.addStandingZone("water_station", { x: r - 1, y: o + 2 }, e.id, "up");
    const c = l.bounds.x + l.bounds.w;
    this.fillDesksInRoom(l, "harvest_check", 4), this.tryPlace(l.bounds.x, 1, "hay_bale"), this.tryPlace(c - 1, 1, "hay_bale"), this.tryPlace(l.bounds.x, this.gridHeight - 2, "water_trough"), this.addStandingZone("water_station", { x: l.bounds.x + 1, y: this.gridHeight - 2 }, l.id, "left");
    const d = n.bounds.x + n.bounds.w;
    this.fillDesksInRoom(n, "market_stand", 3), this.tryPlace(d - 1, 1, "hay_bale"), this.tryPlace(d - 1, this.gridHeight - 2, "tree"), this.tryPlace(n.bounds.x, this.gridHeight - 2, "hay_bale");
  }
  /* ── pirate ship rooms: Captain's Quarters → Main Deck → Crow's Nest → War Room ── */
  buildPirateShipRooms(i) {
    const t = this.createMultipleRooms([
      { name: "Captain's Quarters", widthFraction: 0.2 },
      { name: "Main Deck", widthFraction: 0.35 },
      { name: "Crow's Nest", widthFraction: 0.25 },
      { name: "War Room", widthFraction: 0.2 }
    ]), [s, e, l, n] = t;
    for (let d = 1; d < this.gridWidth - 1; d++)
      this.tiles[1][d].walkable && (this.tiles[1][d] = { type: "ship_hull", walkable: !1 }), this.tiles[this.gridHeight - 2][d].walkable && (this.tiles[this.gridHeight - 2][d] = { type: "ship_hull", walkable: !1 });
    for (let d = 2; d < this.gridWidth - 2; d++)
      for (let f = 1; f < this.gridHeight - 1; f++)
        this.tiles[f][d].type === "wall" && (this.tiles[f][d] = { type: "ship_hull", walkable: !1 });
    const o = s.bounds.x + s.bounds.w;
    this.addDeskZone(s.bounds.x, 3, s.id, "nav_table"), s.bounds.w > 3 && this.addDeskZone(s.bounds.x, 6, s.id, "nav_table"), this.addStandingZone("planning_board", { x: o - 1, y: 3 }, s.id, "up"), this.tryPlace(s.bounds.x, this.gridHeight - 3, "treasure_chest"), this.tryPlace(s.bounds.x, this.gridHeight - 4, "barrel");
    const a = e.bounds.x + e.bounds.w, r = e.bounds.x + Math.floor(e.bounds.w / 2);
    this.tryPlace(r, 2, "crows_nest"), this.tryPlace(r, 2, "jolly_roger");
    for (let d = 3; d < this.gridHeight - 3; d++)
      this.tryPlace(r, d, "ship_mast");
    r - 1 >= e.bounds.x && (this.tryPlace(r - 1, 3, "ship_sail"), this.gridHeight > 10 && this.tryPlace(r - 1, 4, "ship_sail")), r + 1 < a && (this.tryPlace(r + 1, 3, "ship_sail"), this.gridHeight > 10 && this.tryPlace(r + 1, 4, "ship_sail")), this.tryPlace(a - 1, 2, "ship_wheel"), this.addStandingZone("helm", { x: a - 1, y: 3 }, e.id, "up"), this.addStandingZone("rigging", { x: r - 2, y: this.gridHeight - 4 }, e.id, "right"), this.addStandingZone("rigging", { x: r + 2, y: this.gridHeight - 4 }, e.id, "left"), this.addStandingZone("rigging", { x: e.bounds.x, y: 4 }, e.id, "right"), this.tryPlace(e.bounds.x, this.gridHeight - 3, "barrel"), this.tryPlace(e.bounds.x + 1, this.gridHeight - 3, "barrel");
    const h = l.bounds.x + l.bounds.w;
    for (let d = l.bounds.x; d < h; d += 2)
      this.tryPlace(d, 2, "cannon"), this.addStandingZone("cannon_post", { x: d, y: 3 }, l.id, "up");
    this.addStandingZone("lookout", { x: l.bounds.x, y: this.gridHeight - 3 }, l.id, "up"), l.bounds.w > 3 && this.addStandingZone("lookout", { x: l.bounds.x + 3, y: this.gridHeight - 3 }, l.id, "up"), this.tryPlace(h - 1, this.gridHeight - 3, "barrel"), this.tryPlace(h - 1, this.gridHeight - 4, "barrel");
    const c = n.bounds.x + n.bounds.w;
    this.addDeskZone(n.bounds.x, 3, n.id, "war_room"), n.bounds.w > 3 && this.addDeskZone(n.bounds.x, 6, n.id, "war_room"), this.addStandingZone("cargo_hold", { x: c - 1, y: this.gridHeight - 3 }, n.id, "up"), this.tryPlace(c - 1, this.gridHeight - 4, "barrel"), this.tryPlace(n.bounds.x, this.gridHeight - 3, "barrel"), this.tryPlace(n.bounds.x, this.gridHeight - 4, "treasure_chest");
  }
  /* ── hospital rooms: Diagnosis Room → Treatment Lab → Testing Wing → Pharmacy Review ── */
  buildHospitalRooms(i) {
    const t = this.createMultipleRooms([
      { name: "Diagnosis Room", widthFraction: 0.2 },
      { name: "Treatment Lab", widthFraction: 0.35 },
      { name: "Testing Wing", widthFraction: 0.25 },
      { name: "Pharmacy Review", widthFraction: 0.2 }
    ]), [s, e, l, n] = t, o = s.bounds.x + s.bounds.w;
    this.tryPlace(s.bounds.x, 1, "xray_machine"), this.tryPlace(s.bounds.x, 2, "xray_machine"), this.addStandingZone("surgery_room", { x: s.bounds.x + 1, y: 2 }, s.id, "left"), this.fillDesksInRoom(s, "patient_station", 3, 3), this.tryPlace(s.bounds.x, this.gridHeight - 2, "sink"), this.tryPlace(o - 1, 1, "med_cabinet");
    const a = e.bounds.x + e.bounds.w;
    this.tryPlace(e.bounds.x, 1, "hospital_bed"), this.tryPlace(e.bounds.x + 1, 1, "hospital_bed"), e.bounds.w > 5 && (this.tryPlace(e.bounds.x + 3, 1, "curtain"), this.tryPlace(e.bounds.x + 4, 1, "hospital_bed")), this.fillDesksInRoom(e, "lab_bench", Math.ceil(i.maxWorkstations * 0.4)), this.tryPlace(e.bounds.x, this.gridHeight - 2, "sink"), this.tryPlace(a - 1, this.gridHeight - 2, "sink");
    const r = l.bounds.x + l.bounds.w;
    this.fillDesksInRoom(l, "testing_bench", 4), this.tryPlace(l.bounds.x, 1, "med_cabinet"), this.tryPlace(r - 1, 1, "med_cabinet"), this.addStandingZone("ci_monitor", { x: l.bounds.x, y: this.gridHeight - 3 }, l.id, "up");
    const h = n.bounds.x + n.bounds.w;
    for (let c = 2; c < this.gridHeight - 2; c += 2)
      this.tryPlace(h - 1, c, "med_cabinet");
    this.addStandingZone("pharmacy", { x: h - 2, y: 3 }, n.id, "right"), this.addStandingZone("pharmacy_review", { x: h - 2, y: 6 }, n.id, "right"), this.fillDesksInRoom(n, "review_desk", 3), this.tryPlace(n.bounds.x, this.gridHeight - 2, "plant");
  }
  /* ── kanban rooms: one room per stage ───────── */
  buildKanbanRooms(i, t) {
    this.buildOrchestratorCorridor(this.currentEnv);
    const s = t.map((l) => ({
      name: l.name,
      widthFraction: 1 / t.length
    })), e = this.createMultipleRooms(s);
    for (const l of e) this.rooms.push(l);
    for (let l = 0; l < e.length; l++)
      e[l].kanbanStageName = t[l].name, this.populateRoomByStyle(e[l], t[l].buildingStyle ?? "office", i);
  }
  populateRoomByStyle(i, t, s) {
    const e = i.bounds.x + i.bounds.w, l = i.bounds.y + i.bounds.h, n = i.bounds.y + Math.floor(i.bounds.h / 2), o = Math.max(3, Math.min(6, i.bounds.w * 2));
    let a = 0;
    for (let r = n + 1; r < l && a < o; r += 2)
      for (let h = i.bounds.x; h < e && a < o; h++)
        this.tiles[r][h].walkable && (this.addStandingZone("common_area", { x: h, y: r }, i.id, "down"), a++);
  }
  buildTownRooms(i, t) {
    const s = t.length;
    if (s === 0) return;
    const e = this.gridWidth, l = this.gridHeight, o = this.orchestratorSeparatorY + 1;
    for (let p = 0; p < l; p++)
      for (let R = 0; R < e; R++)
        this.tiles[p][R] = { type: "grass", walkable: !0 };
    for (let p = 0; p < e; p++)
      this.tiles[0][p] = { type: "town_hedge", walkable: !1 }, this.tiles[l - 1][p] = { type: "town_hedge", walkable: !1 };
    for (let p = 0; p < l; p++)
      this.tiles[p][0] = { type: "town_hedge", walkable: !1 }, this.tiles[p][e - 1] = { type: "town_hedge", walkable: !1 };
    this.buildOrchestratorCorridor("town");
    const a = Math.floor(e / 2), r = l - o - 1, h = o + Math.floor(r / 2);
    for (let p = 1; p < e - 1; p++)
      this.tiles[h][p] = { type: "road", walkable: !0 }, h - 1 >= o && (this.tiles[h - 1][p] = { type: "cobblestone", walkable: !0 }), h + 1 < l - 1 && (this.tiles[h + 1][p] = { type: "cobblestone", walkable: !0 });
    this.spawnPoint = { x: 1, y: h };
    const c = 2;
    for (let p = -c; p <= c; p++)
      for (let R = -c; R <= c; R++) {
        const C = h + p, P = a + R;
        C >= o && C < l - 1 && P >= 1 && P < e - 1 && this.tiles[C][P].type === "grass" && (this.tiles[C][P] = { type: "cobblestone", walkable: !0 });
      }
    this.tiles[h][a] = { type: "fountain", walkable: !1 };
    const d = 0, f = {
      id: d,
      name: "Town Square",
      bounds: { x: a - c, y: h - c, w: c * 2 + 1, h: c * 2 + 2 },
      doorways: []
    };
    this.rooms.push(f), this.addStandingZone("common_area", { x: a - 1, y: h - 1 }, d, "down"), this.addStandingZone("common_area", { x: a + 1, y: h - 1 }, d, "down"), this.addStandingZone("common_area", { x: a - 1, y: h + 1 }, d, "up"), this.addStandingZone("common_area", { x: a + 1, y: h + 1 }, d, "up"), this.addStandingZone("common_area", { x: a - 2, y: h }, d, "right"), this.addStandingZone("common_area", { x: a + 2, y: h }, d, "left"), this.addStandingZone("common_area", { x: a - 2, y: h - 1 }, d, "right"), this.addStandingZone("common_area", { x: a + 2, y: h + 1 }, d, "left");
    const g = Math.ceil(s / 2), u = s - g, b = o, A = h - b, m = h + 1, k = l - 1 - m, S = 1, w = e - 2 * S;
    let M = 0;
    M = this.placeTownRow(S, b, w, A, t, M, g, h, "top"), M = this.placeTownRow(S, m, w, k, t, M, u, h, "bottom"), this.placeTownDecorRPG(a, h);
  }
  placeTownRow(i, t, s, e, l, n, o, a, r) {
    if (o === 0 || e < 3) return n;
    const h = 2, c = Math.max(5, Math.floor((s - h * Math.max(0, o - 1)) / o)), d = Math.max(3, e);
    for (let f = 0; f < o; f++) {
      const g = n + f;
      if (g >= l.length) break;
      const u = i + f * (c + h);
      u + c > this.gridWidth - 1 || this.createRPGBuilding(u, t, c, d, l[g], g + 1, a, r);
    }
    return n + o;
  }
  createRPGBuilding(i, t, s, e, l, n, o, a) {
    if (i + s > this.gridWidth - 1 && (s = this.gridWidth - 1 - i), t + e > this.gridHeight - 1 && (e = this.gridHeight - 1 - t), s < 3 || e < 3) return;
    const r = this.getRoofType(l.buildingStyle ?? "office", n);
    for (let A = t; A < t + e; A++)
      for (let m = i; m < i + s; m++) {
        const k = A - t;
        a === "top" ? k === 0 ? this.tiles[A][m] = { type: r, walkable: !1 } : k === e - 1 ? this.tiles[A][m] = { type: "building_wall", walkable: !1 } : m === i || m === i + s - 1 ? this.tiles[A][m] = { type: "building_wall", walkable: !1 } : this.tiles[A][m] = { type: "building_floor", walkable: !0 } : k === e - 1 ? this.tiles[A][m] = { type: r, walkable: !1 } : k === 0 ? this.tiles[A][m] = { type: "building_wall", walkable: !1 } : m === i || m === i + s - 1 ? this.tiles[A][m] = { type: "building_wall", walkable: !1 } : this.tiles[A][m] = { type: "building_floor", walkable: !0 };
      }
    const h = i + Math.floor(s / 2), c = [];
    if (a === "top") {
      const A = t + e - 1;
      this.tiles[A][h] = { type: "building_door", walkable: !0 }, c.push({ x: h, y: A });
      for (let S = A + 1; S < o; S++)
        this.tiles[S][h].type === "grass" && (this.tiles[S][h] = { type: "pathway", walkable: !0 });
      const m = h + 1, k = t + e;
      if (k < this.gridHeight - 1 && m < this.gridWidth - 1) {
        const S = this.tiles[k][m].type;
        (S === "grass" || S === "cobblestone" || S === "pathway") && (this.tiles[k][m] = { type: "signpost", walkable: !1 });
      }
    } else {
      const A = t;
      this.tiles[A][h] = { type: "building_door", walkable: !0 }, c.push({ x: h, y: A });
      for (let m = A - 1; m > o; m--)
        this.tiles[m][h].type === "grass" && (this.tiles[m][h] = { type: "pathway", walkable: !0 });
    }
    const d = 1, f = e - 1, g = t + d, u = Math.max(1, f - d), b = {
      id: n,
      name: l.name,
      kanbanStageName: l.name,
      roofY: a === "top" ? t : t + e - 1,
      bounds: { x: i + 1, y: g, w: s - 2, h: u },
      doorways: c
    };
    this.rooms.push(b), this.populateRPGBuilding(b, l.buildingStyle ?? "office");
  }
  getTownBuildingName(i) {
    switch (i.buildingStyle) {
      case "tavern":
        return "Tavern";
      case "workshop":
        return "Workshop";
      case "lab":
        return "Library";
      case "office":
        return "Town Hall";
      case "warehouse":
        return "General Store";
      case "depot":
        return "Trading Post";
      default:
        return i.name;
    }
  }
  getRoofType(i, t) {
    switch (i) {
      case "tavern":
        return "building_roof_brown";
      case "workshop":
        return "building_roof_red";
      case "lab":
        return "building_roof_blue";
      case "warehouse":
        return "building_roof_green";
      case "depot":
        return "building_roof_brown";
      default:
        return this.ROOF_COLORS[t % this.ROOF_COLORS.length];
    }
  }
  populateRPGBuilding(i, t) {
    const s = i.bounds.x + i.bounds.w, e = i.bounds.y + i.bounds.h, l = i.bounds.y + Math.floor(i.bounds.h / 2), n = Math.max(3, Math.min(6, i.bounds.w * 2));
    let o = 0;
    for (let a = l + 1; a < e && o < n; a += 2)
      for (let r = i.bounds.x; r < s && o < n; r++)
        this.tiles[a][r].walkable && (this.addStandingZone("common_area", { x: r, y: a }, i.id, "down"), o++);
  }
  tryPlaceOnFloor(i, t, s) {
    if (i >= 0 && i < this.gridWidth && t >= 0 && t < this.gridHeight) {
      const e = this.tiles[t][i].type;
      (e === "building_floor" || e === "floor") && (this.tiles[t][i] = { type: s, walkable: !1 });
    }
  }
  placeTownDecorRPG(i, t) {
    const s = this.gridWidth, e = this.gridHeight;
    for (let h = 4; h < s - 4; h += 6)
      t - 1 >= 1 && this.tiles[t - 1][h].type === "cobblestone" && (this.tiles[t - 1][h] = { type: "lamppost", walkable: !1 });
    const l = [
      { x: i - 3, y: t - 1, face: "down" },
      { x: i + 3, y: t - 1, face: "down" }
    ];
    for (const h of l)
      if (h.x >= 1 && h.x < s - 1 && h.y >= 1 && h.y < e - 1) {
        const c = this.tiles[h.y][h.x].type;
        if (c === "grass" || c === "cobblestone") {
          this.tiles[h.y][h.x] = { type: "bench", walkable: !1 };
          const d = h.x + 1;
          d < s - 1 && this.tiles[h.y][d].walkable && this.addStandingZone("town_bench_zone", { x: d, y: h.y }, 0, h.face);
        }
      }
    const n = i + 4, o = t - 1;
    n < s - 2 && o >= 1 && this.tiles[o][n].type === "cobblestone" && (this.tiles[o][n] = { type: "well", walkable: !1 });
    const a = [
      { x: i + 5, y: t - 1 }
    ];
    for (const h of a)
      if (h.x >= 1 && h.x < s - 1 && h.y >= 1 && h.y < e - 1) {
        const c = this.tiles[h.y][h.x].type;
        if (c === "grass" || c === "cobblestone") {
          this.tiles[h.y][h.x] = { type: "market_stall", walkable: !1 };
          const d = h.x + 1;
          d < s - 1 && this.tiles[h.y][d].walkable && this.addStandingZone("shop_counter", { x: d, y: h.y }, 0, "left");
        }
      }
    for (let h = 1; h < t; h++)
      for (let c = 1; c < s - 1; c++)
        if (this.tiles[h][c].type === "grass") {
          const d = (c * 31 + h * 17) % 100;
          d < 3 ? this.tiles[h][c] = { type: "town_tree", walkable: !1 } : d >= 3 && d < 5 && (this.tiles[h][c] = { type: "flower_bed", walkable: !1 });
        }
    const r = [
      { x: 2, y: 1 },
      { x: s - 3, y: 1 }
    ];
    for (const h of r)
      this.tiles[h.y][h.x].type === "grass" && (this.tiles[h.y][h.x] = { type: "fence", walkable: !1 });
  }
  /* ── shared helpers ──────────────────────────── */
  set(i, t, s) {
    i >= 0 && i < this.gridWidth && t >= 0 && t < this.gridHeight && (this.tiles[t][i] = { type: s, walkable: !1 });
  }
  tryPlace(i, t, s) {
    if (i >= 1 && i < this.gridWidth - 1 && t >= 1 && t < this.gridHeight - 1) {
      const e = this.tiles[t][i].type;
      (e === "floor" || e === "building_floor") && (this.tiles[t][i] = { type: s, walkable: !1 });
    }
  }
  isWalkable(i, t) {
    return i < 0 || i >= this.gridWidth || t < 0 || t >= this.gridHeight ? !1 : this.tiles[t][i].walkable;
  }
  getAvailableZone(i) {
    if (i) {
      const t = this.zones.find((s) => s.type === i && !s.assignedAgentId);
      if (t) return t;
    }
    return this.zones.find((t) => !t.assignedAgentId) ?? null;
  }
  /** @deprecated Use getAvailableZone instead */
  getAvailableWorkstation() {
    return this.getAvailableZone();
  }
  assignZone(i, t) {
    const s = this.zones.find((e) => e.id === i);
    s && (s.assignedAgentId = t);
  }
  /** @deprecated Use assignZone instead */
  assignWorkstation(i, t) {
    this.assignZone(i, t);
  }
  freeZone(i) {
    const t = this.zones.find((s) => s.assignedAgentId === i);
    t && (t.assignedAgentId = void 0);
  }
  /** @deprecated Use freeZone instead */
  freeWorkstation(i) {
    this.freeZone(i);
  }
  findPath(i, t) {
    if (!this.isWalkable(t.x, t.y)) return [];
    const s = (o) => `${o.x},${o.y}`, e = [i], l = /* @__PURE__ */ new Set([s(i)]), n = /* @__PURE__ */ new Map();
    for (n.set(s(i), null); e.length > 0; ) {
      const o = e.shift();
      if (o.x === t.x && o.y === t.y) {
        const a = [];
        let r = o;
        for (; r; )
          a.unshift(r), r = n.get(s(r)) ?? void 0;
        return a;
      }
      for (const [a, r] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const h = { x: o.x + a, y: o.y + r }, c = s(h);
        !l.has(c) && this.isWalkable(h.x, h.y) && (l.add(c), n.set(c, o), e.push(h));
      }
    }
    return [];
  }
}
const Vt = {
  task_picked: {
    type: "burst",
    count: 8,
    colors: ["#FFD700", "#FFA500", "#FFE44D"],
    speed: 60,
    life: 0.6,
    size: 3
  },
  task_completed: {
    type: "confetti",
    count: 18,
    colors: ["#4CAF50", "#81C784", "#66BB6A", "#A5D6A7", "#FFD700"],
    speed: 80,
    life: 1.5,
    size: 4,
    gravity: 120
  },
  review_submitted: {
    type: "pulse",
    count: 3,
    colors: ["#FF9800", "#FFB74D", "#FFA726"],
    speed: 40,
    life: 0.8,
    size: 6
  },
  error_burst: {
    type: "burst",
    count: 14,
    colors: ["#F44336", "#E53935", "#FF5252", "#FF8A80"],
    speed: 90,
    life: 0.8,
    size: 3
  },
  review_approved: {
    type: "confetti",
    count: 22,
    colors: ["#4CAF50", "#81C784", "#A5D6A7", "#C8E6C9", "#FFD700"],
    speed: 100,
    life: 1.8,
    size: 4,
    gravity: 120
  },
  review_rejected: {
    type: "burst",
    count: 12,
    colors: ["#F44336", "#E53935", "#FF5252"],
    speed: 70,
    life: 0.7,
    size: 3
  }
};
class Ut {
  constructor() {
    this.particles = [], this.maxParticles = 50, this.spawnTimer = 0, this.worldW = 0, this.worldH = 0, this.env = "office";
  }
  configure(i, t, s, e) {
    this.env = i, this.worldW = t * e, this.worldH = s * e, this.particles = [], this.spawnTimer = 0;
  }
  /** Spawn event particles at a world position — bypasses maxParticles cap */
  spawnEventParticles(i, t, s) {
    const e = Vt[s];
    if (e)
      for (let l = 0; l < e.count; l++) {
        const n = Math.PI * 2 * l / e.count + (Math.random() - 0.5) * 0.4, o = e.speed * (0.5 + Math.random() * 0.5), a = e.colors[l % e.colors.length], r = {
          x: i,
          y: t,
          vx: Math.cos(n) * o,
          vy: e.type === "confetti" ? -Math.abs(Math.sin(n) * o) - 30 : Math.sin(n) * o,
          life: e.life * (0.7 + Math.random() * 0.3),
          maxLife: e.life,
          size: e.size * (0.7 + Math.random() * 0.6),
          color: a,
          type: e.type
        };
        e.type === "confetti" && (r.rotation = Math.random() * Math.PI * 2, r.rotationSpeed = (Math.random() - 0.5) * 12), this.particles.push(r);
      }
  }
  /** Spawn welding sparks at a specific world position (for rocket construction) */
  spawnWeldingSparks(i, t) {
    if (!(this.particles.length >= this.maxParticles + 20))
      for (let s = 0; s < 3; s++) {
        const e = Math.random() * Math.PI * 2, l = 20 + Math.random() * 40;
        this.particles.push({
          x: i,
          y: t,
          vx: Math.cos(e) * l,
          vy: Math.sin(e) * l - 10,
          life: 0.2 + Math.random() * 0.3,
          maxLife: 0.5,
          size: 1 + Math.random(),
          color: Math.random() > 0.5 ? "#FFAA33" : "#FFDD66",
          type: "spark"
        });
      }
  }
  update(i) {
    this.spawnTimer -= i, this.spawnTimer <= 0 && this.particles.length < this.maxParticles && (this.spawn(), this.spawnTimer = this.getSpawnInterval());
    for (let t = this.particles.length - 1; t >= 0; t--) {
      const s = this.particles[t];
      s.x += s.vx * i, s.y += s.vy * i, s.life -= i, s.type === "firefly" ? (s.vx += (Math.random() - 0.5) * 20 * i, s.vy += (Math.random() - 0.5) * 20 * i, s.vx *= 0.98, s.vy *= 0.98) : s.type === "leaf" ? s.vx += Math.sin(Date.now() * 2e-3 + s.y * 0.01) * 5 * i : s.type === "confetti" ? (s.vy += 120 * i, s.vx += Math.sin(Date.now() * 3e-3 + s.x * 0.02) * 15 * i, s.rotation !== void 0 && s.rotationSpeed !== void 0 && (s.rotation += s.rotationSpeed * i)) : s.type === "pulse" && (s.size += 30 * i), s.life <= 0 && (this.particles[t] = this.particles[this.particles.length - 1], this.particles.pop());
    }
  }
  render(i) {
    for (const t of this.particles) {
      const s = Math.min(1, t.life / (t.maxLife * 0.3)), e = Math.min(1, (t.maxLife - t.life) / (t.maxLife * 0.15)), l = s * e;
      if (t.type === "firefly") {
        const o = 0.4 + Math.sin(Date.now() * 0.01 + t.x * 0.1) * 0.6;
        i.fillStyle = `rgba(200,255,100,${(l * o * 0.4).toFixed(3)})`, i.beginPath(), i.arc(t.x, t.y, t.size * 3, 0, Math.PI * 2), i.fill();
      }
      const n = this.hexToRgb(t.color);
      if (t.type === "confetti") {
        i.save(), i.translate(t.x, t.y), i.rotate(t.rotation ?? 0), i.fillStyle = `rgba(${n},${(l * 0.85).toFixed(3)})`, i.fillRect(-t.size / 2, -t.size / 4, t.size, t.size / 2), i.restore();
        continue;
      }
      if (t.type === "burst") {
        i.fillStyle = `rgba(${n},${(l * 0.8).toFixed(3)})`, i.fillRect(t.x - t.size / 2, t.y - t.size / 2, t.size, t.size);
        continue;
      }
      if (t.type === "pulse") {
        i.strokeStyle = `rgba(${n},${(l * 0.6).toFixed(3)})`, i.lineWidth = 2, i.beginPath(), i.arc(t.x, t.y, t.size, 0, Math.PI * 2), i.stroke();
        continue;
      }
      i.fillStyle = `rgba(${n},${(l * 0.5).toFixed(3)})`, i.fillRect(t.x - t.size / 2, t.y - t.size / 2, t.size, t.size);
    }
  }
  spawn() {
    const { worldW: i, worldH: t } = this;
    switch (this.env) {
      case "office":
        this.particles.push({
          x: Math.random() * i,
          y: Math.random() * t,
          vx: (Math.random() - 0.5) * 3,
          vy: -Math.random() * 2 - 0.5,
          life: 5 + Math.random() * 5,
          maxLife: 10,
          size: Math.max(1, 1 + Math.random()),
          color: "#FFFFFF",
          type: "dust"
        });
        break;
      case "farm":
        Math.random() < 0.3 ? this.particles.push({
          x: Math.random() * i,
          y: t * 0.3 + Math.random() * t * 0.6,
          vx: (Math.random() - 0.5) * 8,
          vy: (Math.random() - 0.5) * 8,
          life: 4 + Math.random() * 4,
          maxLife: 8,
          size: 2,
          color: "#CCFF44",
          type: "firefly"
        }) : this.particles.push({
          x: Math.random() * i,
          y: -5,
          vx: Math.random() * 5 + 2,
          vy: Math.random() * 10 + 5,
          life: 6 + Math.random() * 3,
          maxLife: 9,
          size: 3,
          color: "#8B6914",
          type: "leaf"
        });
        break;
      case "space_station":
        this.particles.push({
          x: Math.random() * i,
          y: Math.random() * t,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          life: 6 + Math.random() * 4,
          maxLife: 10,
          size: 1,
          color: "#88BBFF",
          type: "star"
        });
        break;
      case "rocket":
        this.particles.push({
          x: i * 0.7 + (Math.random() - 0.5) * i * 0.15,
          y: t * 0.8 + Math.random() * t * 0.1,
          vx: (Math.random() - 0.5) * 30,
          vy: -Math.random() * 20 - 5,
          life: 0.4 + Math.random() * 0.6,
          maxLife: 1,
          size: 2,
          color: "#FFAA33",
          type: "spark"
        });
        break;
      case "pirate_ship":
        this.particles.push({
          x: Math.random() * i,
          y: t - Math.random() * t * 0.08,
          vx: (Math.random() - 0.5) * 10,
          vy: -Math.random() * 12 - 3,
          life: 1 + Math.random() * 2,
          maxLife: 3,
          size: 2,
          color: "#88CCEE",
          type: "spray"
        });
        break;
      case "hospital":
        this.particles.push({
          x: Math.random() * i,
          y: Math.random() * t,
          vx: (Math.random() - 0.5) * 1,
          vy: -Math.random() * 0.5,
          life: 8 + Math.random() * 5,
          maxLife: 13,
          size: 1,
          color: "#FFFFFF",
          type: "dust"
        });
        break;
      case "town":
        Math.random() < 0.7 ? this.particles.push({
          x: Math.random() * i,
          y: -5,
          vx: Math.random() * 4 + 1,
          vy: Math.random() * 8 + 4,
          life: 7 + Math.random() * 4,
          maxLife: 11,
          size: 3,
          color: "#8B6914",
          type: "leaf"
        }) : this.particles.push({
          x: Math.random() * i,
          y: Math.random() * t,
          vx: (Math.random() - 0.5) * 2,
          vy: -Math.random() * 2 - 0.5,
          life: 6 + Math.random() * 5,
          maxLife: 11,
          size: 1,
          color: "#FFE4B5",
          type: "dust"
        });
        break;
    }
  }
  getSpawnInterval() {
    switch (this.env) {
      case "rocket":
        return 0.06;
      case "pirate_ship":
        return 0.25;
      case "farm":
        return 0.5;
      case "office":
        return 1;
      case "space_station":
        return 0.6;
      case "hospital":
        return 2;
      case "town":
        return 0.8;
      default:
        return 1;
    }
  }
  hexToRgb(i) {
    const t = parseInt(i.slice(1, 3), 16), s = parseInt(i.slice(3, 5), 16), e = parseInt(i.slice(5, 7), 16);
    return `${t},${s},${e}`;
  }
}
const et = {
  // Planning phase — amber/orange
  planning: "#F39C12",
  analyzing: "#E67E22",
  decomposing: "#D35400",
  // Research — purple
  searching: "#8E44AD",
  reading: "#9B59B6",
  grepping: "#7D3C98",
  // Execution — blue
  coding: "#3498DB",
  generating: "#2980B9",
  refactoring: "#2471A3",
  // Validation — teal
  testing: "#1ABC9C",
  linting: "#16A085",
  validating: "#148F77",
  // Integration — indigo
  committing: "#5B5EA6",
  pushing: "#6C5CE7",
  deploying: "#4834D4",
  // Review — orange
  reviewing: "#E67E22",
  waiting_approval: "#F39C12",
  // Terminal states
  idle: "#95A5A6",
  success: "#27AE60",
  error: "#E74C3C",
  paused: "#BDC3C7",
  blocked: "#C0392B"
}, it = ["#2C3E50", "#1A1A2E", "#34495E", "#283747", "#212F3D"], st = ["#5B9BD5", "#27AE60", "#E891B2", "#48C9B0", "#5DADE2"], lt = ["#B5422C", "#2E6B4E", "#8B6914", "#4A6FA5", "#CC7722", "#884422"], ot = ["#CC3333", "#1A1A2E", "#5A3A1A", "#2C6B4E", "#8B6914", "#333366"], at = ["#7A3B2E", "#2E5A3B", "#3A4A7A", "#8B6914", "#6A2A5A", "#CC7722", "#4A6A4A", "#AA4444"], Kt = {
  coding: "pencil",
  generating: "pencil",
  refactoring: "hammer",
  planning: "clipboard",
  analyzing: "clipboard",
  decomposing: "clipboard",
  searching: "magnifier",
  grepping: "magnifier",
  reading: "book",
  testing: "flask",
  validating: "flask",
  linting: "checkmark",
  committing: "wrench",
  pushing: "wrench",
  deploying: "wrench",
  reviewing: "magnifier",
  waiting_approval: "hourglass",
  success: "checkmark",
  error: "warning"
}, G = class G {
  constructor(i, t, s, e, l = "hybrid", n = "office") {
    this.canvas = i, this.env = "office", this.theme = "hybrid", this.starCache = [], this.warpStars = [], this.colorCache = /* @__PURE__ */ new Map(), this.floorNoise = new Uint8Array(0), this.particles = new Ut(), this.lightCanvas = null, this.shakeOffset = { x: 0, y: 0 }, this.shakeEnd = 0, this.flashColor = "", this.flashStart = 0, this.flashDuration = 0, this.openDoors = /* @__PURE__ */ new Set(), this.doorCloseTimers = /* @__PURE__ */ new Map(), this.ctx = i.getContext("2d"), this.world = t, this.scale = s, this.tileSize = e, this.env = n, this.theme = l, this.colors = n === "office" ? q[l] : tt[n], this.ctx.imageSmoothingEnabled = !1, this.generateStars(), this.generateFloorNoise(), this.particles.configure(n, t.gridWidth, t.gridHeight, this.tileSize * this.scale);
  }
  get ts() {
    return this.tileSize * this.scale;
  }
  /** Ceil'd tile size for fill operations — prevents 1px gaps between tiles at fractional scale */
  get tsCeil() {
    return Math.ceil(this.tileSize * this.scale);
  }
  resize(i, t) {
    this.canvas.width = i, this.canvas.height = t, this.ctx.imageSmoothingEnabled = !1;
  }
  setScale(i) {
    this.scale = i, this.particles.configure(this.env, this.world.gridWidth, this.world.gridHeight, this.ts);
  }
  setTheme(i) {
    this.theme = i, this.env === "office" && (this.colors = q[i]);
  }
  setEnvironment(i, t) {
    this.env = i, this.theme = t, this.colors = i === "office" ? q[t] : tt[i], this.generateStars(), this.generateFloorNoise(), this.particles.configure(i, this.world.gridWidth, this.world.gridHeight, this.ts);
  }
  updateParticles(i) {
    this.particles.update(i);
  }
  spawnWeldingSparks(i, t) {
    const s = i * this.ts + this.ts / 2, e = t * this.ts;
    this.particles.spawnWeldingSparks(s, e);
  }
  spawnEventParticles(i, t, s) {
    const e = i * this.ts + this.ts / 2, l = t * this.ts + this.ts / 2;
    this.particles.spawnEventParticles(e, l, s), (s === "error_burst" || s === "review_rejected") && this.shake(2.5, 180);
  }
  /** Trigger screen shake (for error bursts, impacts) */
  shake(i = 3, t = 200) {
    this.shakeEnd = Date.now() + t, this.shakeOffset = { x: (Math.random() - 0.5) * i * 2, y: (Math.random() - 0.5) * i * 2 };
  }
  /** Trigger screen flash (white for success, red for error) */
  flash(i, t = 300) {
    this.flashColor = i, this.flashStart = Date.now(), this.flashDuration = t;
  }
  render(i, t) {
    const { ctx: s, canvas: e } = this;
    this.env === "town" && this.updateDoorStates(i), s.fillStyle = this.colors.bg, s.fillRect(0, 0, e.width, e.height), (this.env === "space_station" || this.env === "rocket" || this.env === "pirate_ship") && this.drawStars();
    const l = this.world.gridWidth * this.ts, n = this.world.gridHeight * this.ts;
    let o = Math.floor((e.width - l) / 2), a = Math.floor((e.height - n) / 2);
    if (Date.now() < this.shakeEnd) {
      const h = (this.shakeEnd - Date.now()) / 200;
      this.shakeOffset.x = (Math.random() - 0.5) * 3 * h, this.shakeOffset.y = (Math.random() - 0.5) * 3 * h, o += Math.round(this.shakeOffset.x), a += Math.round(this.shakeOffset.y);
    }
    s.save(), s.translate(o, a), this.drawFloor(), this.drawDecor(), this.drawWorkstations(), t && this.drawTaskItems(t), this.drawGlowEffects(), this.particles.render(s);
    const r = i.filter((h) => h.visible).sort((h, c) => h.y - c.y);
    this.drawConversationLines(r);
    for (const h of r) this.drawAgent(h);
    t && this.drawFlyingTasks(t), this.drawLightingOverlay(), t && this.drawAgentTaskConnections(r, t);
    for (const h of r)
      this.drawBubble(h), this.drawNameLabel(h), this.drawStatusIcon(h);
    if (this.drawRoomLabels(), s.restore(), this.flashStart) {
      const h = Date.now() - this.flashStart, c = Math.max(0, 1 - h / this.flashDuration) * 0.25;
      c > 0 ? (s.fillStyle = this.flashColor.includes("rgba") ? this.flashColor : `rgba(255,255,255,${c})`, s.fillRect(0, 0, e.width, e.height)) : this.flashStart = 0;
    }
  }
  getAgentAt(i, t, s) {
    const e = this.world.gridWidth * this.ts, l = this.world.gridHeight * this.ts, n = (this.canvas.width - e) / 2, o = (this.canvas.height - l) / 2, a = (i - n) / this.ts, r = (t - o) / this.ts;
    for (const h of s)
      if (Math.abs(a - (h.x + 0.5)) < 0.6 && Math.abs(r - (h.y + 0.5)) < 0.6) return h;
    return null;
  }
  /* ── environment outfit palette ─────────────── */
  getEnvPalette(i) {
    const t = i.paletteIndex;
    switch (this.env) {
      case "space_station":
        return { ...i.palette, shirt: "#E0E0E0", pants: "#C8C8D0", shoes: "#888888" };
      case "rocket":
        return { ...i.palette, shirt: "#FF8C00", pants: "#555566", shoes: "#444455" };
      case "hospital": {
        if (t % 3 === 0) return { ...i.palette, shirt: "#FFFFFF", pants: "#E0E8E0", shoes: "#D0D0D0" };
        const s = st[t % st.length];
        return { ...i.palette, shirt: s, pants: s, shoes: "#888888" };
      }
      case "farm":
        return {
          ...i.palette,
          shirt: lt[t % lt.length],
          pants: "#5C4A32",
          shoes: "#5A3A1A"
        };
      case "pirate_ship":
        return {
          ...i.palette,
          shirt: ot[t % ot.length],
          pants: "#3A2A1A",
          shoes: "#2A1A0A"
        };
      case "town":
        return {
          ...i.palette,
          shirt: at[t % at.length],
          pants: "#5A4A32",
          shoes: "#3A2A1A"
        };
      case "office":
        return this.theme === "business" ? {
          ...i.palette,
          shirt: it[t % it.length],
          pants: "#1A1A2E",
          shoes: "#1A1A1A"
        } : i.palette;
      default:
        return i.palette;
    }
  }
  /* ── stars (space backgrounds) ──────────────── */
  generateStars() {
    if (this.starCache = [], this.warpStars = [], this.env === "pirate_ship") {
      for (let i = 0; i < 80; i++)
        this.starCache.push({
          x: Math.random(),
          y: Math.random() * 0.4,
          r: Math.random() * 1.2 + 0.3,
          b: Math.random() * 0.5 + 0.5
        });
      return;
    }
    if (!(this.env !== "space_station" && this.env !== "rocket")) {
      for (let i = 0; i < 120; i++)
        this.starCache.push({
          x: Math.random(),
          y: Math.random(),
          r: Math.random() * 1.5 + 0.5,
          b: Math.random() * 0.5 + 0.5
        });
      if (this.env === "space_station")
        for (let i = 0; i < 40; i++)
          this.warpStars.push({
            x: Math.random(),
            // 0-1 across viewscreen width
            y: Math.random(),
            // 0-1 across viewscreen height
            speed: 0.3 + Math.random() * 0.7,
            // streak speed
            len: 0.08 + Math.random() * 0.2,
            // streak length
            brightness: 0.5 + Math.random() * 0.5
          });
    }
  }
  drawStars() {
    const { ctx: i, canvas: t } = this;
    for (const s of this.starCache) {
      const e = s.b * 0.6 + Math.sin(Date.now() * 1e-3 + s.x * 100) * 0.15;
      i.fillStyle = `rgba(255,255,255,${e.toFixed(2)})`, i.beginPath(), i.arc(s.x * t.width, s.y * t.height, s.r, 0, Math.PI * 2), i.fill();
    }
  }
  /* ── floor noise ──────────────────────────────── */
  generateFloorNoise() {
    const i = this.world.gridWidth, t = this.world.gridHeight;
    this.floorNoise = new Uint8Array(i * t);
    let s = 42;
    for (let e = 0; e < i * t; e++)
      s = s * 1103515245 + 12345 & 2147483647, this.floorNoise[e] = s & 255;
  }
  /* ── floor & walls ──────────────────────────── */
  drawFloor() {
    const { ctx: i, ts: t } = this, s = this.colors, e = this.world;
    for (let l = 0; l < e.gridHeight; l++)
      for (let n = 0; n < e.gridWidth; n++) {
        const o = e.tiles[l][n], a = n * t, r = l * t;
        if (o.type === "wall")
          this.drawWallTile(a, r);
        else if (o.type === "rug")
          this.shadedRect(a, r, t, t, s.rug, { outline: !1, shadowAmt: 0.06, highlightAmt: 0.06 });
        else if (o.type === "grass") {
          const h = [s.floor, s.floorAlt, this.darken(s.floor, 0.04)];
          i.fillStyle = h[(n * 7 + l * 13) % 3], i.fillRect(a, r, t, t);
          const c = this.floorNoise[l * e.gridWidth + n] || 0;
          if (c % 3 === 0 && (i.fillStyle = this.darken(s.floor, 0.12), i.fillRect(a + c * 3 % t, r + c * 7 % t, 1, 1), i.fillRect(a + c * 11 % t, r + c * 5 % t, 1, 1)), c % 4 === 0 && (i.fillStyle = this.lighten(s.floorAlt, 0.08), i.fillRect(a + c * 9 % t, r + c * 2 % t, 1, 1)), c % 5 < 2 && (i.fillStyle = this.darken(s.plantLeaf, 0.1), i.fillRect(a + t * 0.25, r + t * 0.7, t * 0.04, t * 0.14), i.fillRect(a + t * 0.45, r + t * 0.65, t * 0.03, t * 0.18), i.fillRect(a + t * 0.34, r + t * 0.72, t * 0.03, t * 0.12)), c % 7 === 0 && (i.fillStyle = this.lighten(s.plantLeafAlt, 0.1), i.fillRect(a + t * 0.7, r + t * 0.3, t * 0.04, t * 0.12), i.fillRect(a + t * 0.78, r + t * 0.35, t * 0.03, t * 0.1)), c % 18 === 0) {
            const d = ["#E74C3C", "#F1C40F", "#FF69B4", "#FFFFFF"][c % 4];
            i.fillStyle = d, i.fillRect(a + t * 0.5, r + t * 0.4, 2, 2);
          }
        } else if (o.type === "road" || o.type === "road_cross") {
          const h = "#8A8A7A";
          i.fillStyle = h, i.fillRect(a, r, t, t);
          const c = this.floorNoise[l * e.gridWidth + n] || 0, d = ["#A29A8A", "#9A9282", "#8E8678", "#96907E"], f = Math.max(2, Math.floor(t / 3)), g = Math.max(3, Math.floor(t / 2));
          for (let u = 0; u < t; u += f) {
            const b = Math.floor(u / f) % 2 * Math.floor(g / 2);
            for (let A = -b; A < t; A += g) {
              const m = Math.abs((A + u + c) * 7) % 4;
              i.fillStyle = d[m];
              const k = g - 1 + (m % 2 === 0 ? 0 : -1);
              i.fillRect(a + Math.max(0, A), r + u, Math.min(k, t - Math.max(0, A)), f - 1);
            }
            i.fillStyle = "#6A6258", i.fillRect(a, r + u + f - 1, t, 1);
          }
          o.type === "road_cross" && (i.fillStyle = "rgba(255,255,255,0.2)", i.fillRect(a + t * 0.1, r + t * 0.45, t * 0.8, t * 0.1), i.fillRect(a + t * 0.45, r + t * 0.1, t * 0.1, t * 0.8));
        } else if (o.type === "cobblestone") {
          i.fillStyle = "#9A9080", i.fillRect(a, r, t, t);
          const h = this.floorNoise[l * e.gridWidth + n] || 0, c = ["#A8A090", "#9E9688", "#928A7E", "#A49C8C"], d = Math.max(2, Math.floor(t / 3)), f = Math.max(3, Math.floor(t / 2));
          for (let g = 0; g < t; g += d) {
            const u = Math.floor(g / d) % 2 * Math.floor(f / 2);
            for (let b = -u; b < t; b += f)
              i.fillStyle = c[Math.abs((b + g + h) * 5) % 4], i.fillRect(a + Math.max(0, b), r + g, Math.min(f - 1, t - Math.max(0, b)), d - 1);
            i.fillStyle = "#7A7268", i.fillRect(a, r + g + d - 1, t, 1);
          }
        } else if (o.type === "town_stairs") {
          const h = "#B0A89A";
          i.fillStyle = h, i.fillRect(a, r, t, t), i.fillStyle = "#C8C0B4", i.fillRect(a, r, t, Math.max(1, t * 0.15)), i.fillStyle = "#8A8278", i.fillRect(a, r + t - Math.max(1, t * 0.1), t, Math.max(1, t * 0.1)), (this.floorNoise[l * e.gridWidth + n] || 0) % 3 === 0 && (i.fillStyle = "rgba(0,0,0,0.03)", i.fillRect(a + t * 0.2, r + t * 0.3, t * 0.3, t * 0.2));
        } else if (o.type === "building_floor") {
          const h = (n + l) % 2 === 0 ? "#C4A06A" : "#BA9660";
          i.fillStyle = h, i.fillRect(a, r, t, t), (this.floorNoise[l * e.gridWidth + n] || 0) % 3 < 2 && (i.fillStyle = this.darken(h, 0.06), i.fillRect(a + 1, r + t * 0.35, t - 2, 1), i.fillRect(a + 3, r + t * 0.65, t - 6, 1)), l > 0 && !e.tiles[l - 1][n].walkable && (i.fillStyle = "rgba(0,0,0,0.06)", i.fillRect(a, r, t, 2)), n > 0 && !e.tiles[l][n - 1].walkable && (i.fillStyle = "rgba(0,0,0,0.04)", i.fillRect(a, r, 2, t));
        } else if (o.type === "building_wall") {
          this.shadedRect(a, r, t, t, s.wall, { outline: !1, highlightAmt: 0.08, shadowAmt: 0.1 });
          const h = this.floorNoise[l * e.gridWidth + n] || 0;
          h % 3 === 0 && (i.fillStyle = this.darken(s.wall, 0.06), i.fillRect(a + 1, r + t * 0.45, t - 2, 1)), h % 4 === 0 && (i.fillStyle = this.darken(s.wall, 0.05), i.fillRect(a + t * 0.3, r + t * 0.2, 1, t * 0.25)), i.fillStyle = s.wallTop, i.fillRect(a, r, t, t * 0.28), i.fillStyle = this.lighten(s.wallTop, 0.15), i.fillRect(a, r, t, Math.max(1, t * 0.04)), i.strokeStyle = s.wallBorder, i.lineWidth = 1, i.strokeRect(a + 0.5, r + 0.5, t - 1, t - 1);
        } else if (o.type === "building_door") {
          const h = `${n},${l}`;
          if (this.openDoors.has(h))
            i.fillStyle = "#2A1A10", i.fillRect(a, r, t, t), i.fillStyle = "rgba(255,200,100,0.15)", i.fillRect(a + t * 0.1, r + t * 0.1, t * 0.8, t * 0.8), i.fillStyle = "#3A2A18", i.fillRect(a + t * 0.15, r + t * 0.7, t * 0.7, t * 0.25), i.fillStyle = this.darken(s.wall, 0.1), i.fillRect(a, r, t * 0.1, t), i.fillRect(a + t * 0.9, r, t * 0.1, t), i.fillRect(a, r, t, t * 0.06), i.fillStyle = "#7A5A32", i.fillRect(a + t * 0.82, r + t * 0.08, t * 0.08, t * 0.84), i.fillStyle = this.darken("#7A5A32", 0.15), i.fillRect(a + t * 0.82, r + t * 0.08, 1, t * 0.84), i.fillStyle = "#CCAA44", i.fillRect(a + t * 0.83, r + t * 0.45, 2, 2), i.fillStyle = "#555", i.fillRect(a + t * 0.88, r + t * 0.2, t * 0.04, t * 0.03), i.fillRect(a + t * 0.88, r + t * 0.6, t * 0.04, t * 0.03);
          else {
            const d = "#7A5A32";
            i.fillStyle = "#9A8A6A", i.fillRect(a, r, t, t), this.shadedRect(a + t * 0.15, r + t * 0.05, t * 0.7, t * 0.9, d), i.fillStyle = this.darken(d, 0.08), i.fillRect(a + t * 0.35, r + t * 0.08, 1, t * 0.82), i.fillRect(a + t * 0.55, r + t * 0.08, 1, t * 0.82), i.fillStyle = this.lighten(d, 0.1), i.fillRect(a + t * 0.38, r + t * 0.15, t * 0.16, t * 0.7), i.fillStyle = this.darken(d, 0.2), i.fillRect(a + t * 0.12, r, t * 0.76, t * 0.04), i.fillRect(a + t * 0.12, r, t * 0.04, t * 0.9), i.fillRect(a + t * 0.84, r, t * 0.04, t * 0.9), i.fillStyle = "#555", i.fillRect(a + t * 0.15, r + t * 0.2, t * 0.08, t * 0.03), i.fillRect(a + t * 0.15, r + t * 0.6, t * 0.08, t * 0.03), i.fillStyle = "#CCAA44", i.beginPath(), i.arc(a + t * 0.68, r + t * 0.5, t * 0.04, 0, Math.PI * 2), i.fill(), i.fillStyle = "#FFD700", i.fillRect(a + t * 0.67, r + t * 0.48, 1, 1);
          }
        } else if (o.type === "building_roof" || o.type === "building_roof_red" || o.type === "building_roof_blue" || o.type === "building_roof_brown" || o.type === "building_roof_green") {
          const c = {
            building_roof: "#6A4A3A",
            building_roof_red: "#B03030",
            building_roof_blue: "#3060A0",
            building_roof_brown: "#8A6A40",
            building_roof_green: "#3A7A3A"
          }[o.type] ?? "#6A4A3A";
          i.fillStyle = c, i.fillRect(a, r, t, t);
          const d = Math.max(2, Math.floor(t / 3)), f = Math.max(3, Math.floor(t / 2));
          for (let g = 0; g < t; g += d) {
            const u = g / d % 2 * Math.floor(f / 2);
            i.fillStyle = this.darken(c, 0.15), i.fillRect(a, r + g + d - 1, t, 1);
            for (let b = -u; b < t; b += f)
              i.fillRect(a + b + f - 1, r + g, 1, d);
          }
          if (i.fillStyle = this.lighten(c, 0.2), i.fillRect(a, r + t * 0.14, t, Math.max(1, t * 0.05)), i.fillStyle = this.lighten(c, 0.15), i.fillRect(a, r, t, Math.max(1, t * 0.06)), i.fillStyle = this.darken(c, 0.2), i.fillRect(a, r + t - 1, t, 1), l + 1 < e.gridHeight) {
            const g = e.tiles[l + 1][n].type;
            (g === "building_wall" || g === "building_window" || g === "building_door") && (i.fillStyle = "rgba(0,0,0,0.15)", i.fillRect(a, (l + 1) * t, t, Math.max(2, t * 0.12)));
          }
        } else if (o.type === "building_chimney") {
          i.fillStyle = "#6A4A3A", i.fillRect(a, r, t, t), this.shadedRect(a + t * 0.3, r + t * 0.15, t * 0.4, t * 0.75, "#7A6A5A"), i.fillStyle = "#8A7A6A", i.fillRect(a + t * 0.25, r + t * 0.1, t * 0.5, t * 0.08);
          for (let h = 0; h < 4; h++) {
            const c = (Date.now() * 1e-3 + h * 0.8) % 3, d = a + t * 0.45 + Math.sin(c * 2 + h) * t * 0.08, f = r + t * 0.05 - c * t * 0.12, g = Math.max(0, 0.3 - c * 0.1), u = t * (0.04 + c * 0.025);
            i.fillStyle = `rgba(200,200,210,${g.toFixed(2)})`, i.beginPath(), i.arc(d, f, u, 0, Math.PI * 2), i.fill();
          }
        } else if (o.type === "building_window") {
          this.shadedRect(a, r, t, t, s.wall, { outline: !1, highlightAmt: 0.08, shadowAmt: 0.1 }), i.fillStyle = s.wallTop, i.fillRect(a, r, t, t * 0.28), i.fillStyle = this.lighten(s.wallTop, 0.15), i.fillRect(a, r, t, Math.max(1, t * 0.04));
          const h = 0.3 + Math.sin(Date.now() * 2e-3 + n * 3.7) * 0.05;
          i.fillStyle = `rgba(255,200,100,${h.toFixed(2)})`, i.fillRect(a + t * 0.18, r + t * 0.33, t * 0.64, t * 0.44), this.shadedRect(a + t * 0.15, r + t * 0.3, t * 0.7, t * 0.5, "#4A6A8A", { highlightAmt: 0.15 }), i.fillStyle = "rgba(150,200,255,0.15)", i.fillRect(a + t * 0.18, r + t * 0.33, t * 0.2, t * 0.12), i.fillStyle = s.wallBorder, i.fillRect(a + t * 0.48, r + t * 0.3, t * 0.04, t * 0.5), i.fillRect(a + t * 0.15, r + t * 0.53, t * 0.7, t * 0.04), i.fillStyle = this.darken(s.wall, 0.15), i.fillRect(a + t * 0.05, r + t * 0.3, t * 0.08, t * 0.5), i.fillRect(a + t * 0.87, r + t * 0.3, t * 0.08, t * 0.5), i.fillStyle = this.lighten(s.wall, 0.1), i.fillRect(a + t * 0.12, r + t * 0.78, t * 0.76, t * 0.06), i.fillStyle = "#6B4423", i.fillRect(a + t * 0.15, r + t * 0.84, t * 0.7, t * 0.08);
          const c = ["#E74C3C", "#F1C40F", "#FF69B4"];
          for (let d = 0; d < 3; d++)
            i.fillStyle = "#3A7A2A", i.fillRect(a + t * (0.25 + d * 0.2), r + t * 0.78, 1, t * 0.06), i.fillStyle = c[d], i.fillRect(a + t * (0.24 + d * 0.2), r + t * 0.76, 2, 2);
          i.strokeStyle = s.wallBorder, i.lineWidth = 1, i.strokeRect(a + 0.5, r + 0.5, t - 1, t - 1);
        } else if (o.type === "building_awning") {
          this.shadedRect(a, r, t, t, s.wall, { outline: !1 });
          const h = Math.max(2, Math.floor(t / 4));
          for (let c = 0; c < t; c += h * 2)
            i.fillStyle = "#CC4444", i.fillRect(a + c, r + t * 0.5, h, t * 0.35), i.fillStyle = "#EEEECC", i.fillRect(a + c + h, r + t * 0.5, h, t * 0.35);
          i.fillStyle = "rgba(0,0,0,0.15)", i.fillRect(a, r + t * 0.85, t, t * 0.15);
        } else if (o.type === "town_hedge") {
          const h = "#2A5A2A";
          i.fillStyle = h, i.fillRect(a, r, t, t);
          const c = ["#3A6A2A", "#2A6A3A", "#4A7A3A", "#356830"];
          for (let d = 0; d < 5; d++) {
            const f = a + (d * 7 + n * 3) % t, g = r + (d * 11 + l * 5) % t, u = t * (0.18 + d % 3 * 0.06);
            i.fillStyle = c[d % c.length], i.beginPath(), i.arc(f, g, u, 0, Math.PI * 2), i.fill();
          }
          i.strokeStyle = "#1A4A1A", i.lineWidth = 1, i.strokeRect(a + 0.5, r + 0.5, t - 1, t - 1);
        } else if (o.type === "pathway") {
          const h = "#9A8A6A";
          i.fillStyle = h, i.fillRect(a, r, t, t);
          const c = this.floorNoise[l * e.gridWidth + n] || 0, d = ["#B0A080", "#A89878", "#9E9070"];
          for (let f = 0; f < 3; f++) {
            const g = a + c * (f + 1) * 7 % Math.max(1, Math.floor(t * 0.6)) + t * 0.1, u = r + c * (f + 1) * 11 % Math.max(1, Math.floor(t * 0.6)) + t * 0.1, b = t * (0.12 + f % 2 * 0.04);
            i.fillStyle = d[f], i.beginPath(), i.arc(g, u, b, 0, Math.PI * 2), i.fill();
          }
          i.fillStyle = this.colors.floor, i.fillRect(a, r, 1, t), i.fillRect(a + t - 1, r, 1, t), i.fillRect(a, r, t, 1), i.fillRect(a, r + t - 1, t, 1);
        } else {
          const h = (n + l) % 2 === 0 ? s.floor : s.floorAlt;
          i.fillStyle = h, i.fillRect(a, r, t, t);
          const c = this.floorNoise[l * e.gridWidth + n] || 0, d = c % 3 + 1;
          i.fillStyle = this.darken(h, 0.06);
          for (let f = 0; f < d; f++) {
            const g = c * (f + 1) * 7 % Math.max(1, t - 4) + 2, u = c * (f + 1) * 13 % Math.max(1, t - 4) + 2, b = Math.max(1, Math.floor(this.scale * 0.3));
            i.fillRect(a + g, r + u, b, b);
          }
          this.drawFloorDetail(a, r, n, l, c, h), i.strokeStyle = s.floorGrid, i.lineWidth = 1, i.strokeRect(a + 0.5, r + 0.5, t - 1, t - 1);
        }
      }
    this.drawWallShadows(), (this.env === "town" || this.env === "farm") && this.drawTerrainEdges();
  }
  drawFloorDetail(i, t, s, e, l, n) {
    const { ctx: o, ts: a } = this;
    switch (this.env) {
      case "office":
        l % 5 === 0 && (o.fillStyle = this.darken(n, 0.04), o.fillRect(i + l * 3 % a, t + l * 7 % a, 1, 1), o.fillRect(i + l * 11 % a, t + l * 13 % a, 1, 1)), l % 9 === 0 && (o.fillStyle = this.lighten(n, 0.03), o.fillRect(i + l * 5 % a, t + l * 2 % a, 1, 1));
        break;
      case "farm":
        l % 7 === 0 && (o.fillStyle = "#4A8A2A", o.fillRect(i + a * 0.3, t + a * 0.72, a * 0.04, a * 0.12), o.fillRect(i + a * 0.5, t + a * 0.68, a * 0.03, a * 0.16), o.fillRect(i + a * 0.38, t + a * 0.75, a * 0.03, a * 0.1));
        break;
      case "pirate_ship":
        l % 4 < 2 && (o.fillStyle = this.darken(n, 0.06), o.fillRect(i + 2, t + a * 0.35, a - 4, 1), o.fillRect(i + 4, t + a * 0.65, a - 8, 1));
        break;
      case "hospital":
        l % 11 === 0 && (o.fillStyle = this.lighten(n, 0.08), o.fillRect(i + a * 0.2, t + a * 0.2, a * 0.15, a * 0.08));
        break;
      case "rocket":
        if (e % 2 === 0 && (o.fillStyle = this.darken(n, 0.06), o.fillRect(i, t + a - 1, a, 1)), s % 3 === 0 && (o.fillStyle = this.darken(n, 0.04), o.fillRect(i + a - 1, t, 1, a)), l % 23 === 0) {
          o.fillStyle = "rgba(255,180,0,0.12)", o.fillRect(i, t + a * 0.4, a, a * 0.2), o.fillStyle = "rgba(20,20,20,0.1)";
          for (let r = 0; r < a; r += 4)
            o.fillRect(i + r, t + a * 0.4, 2, a * 0.2);
        }
        break;
      case "space_station":
        e % 2 === 0 && (o.fillStyle = this.lighten(n, 0.04), o.fillRect(i + a * 0.48, t, a * 0.04, a));
        break;
      case "town":
        l % 7 === 0 && (o.fillStyle = "#4A8A2A", o.fillRect(i + a * 0.3, t + a * 0.72, a * 0.04, a * 0.12), o.fillRect(i + a * 0.5, t + a * 0.68, a * 0.03, a * 0.16), o.fillRect(i + a * 0.38, t + a * 0.75, a * 0.03, a * 0.1));
        break;
    }
  }
  /** Draw soft grass edges where grass meets hard terrain (road, cobblestone, pathway) */
  drawTerrainEdges() {
    const { ctx: i, ts: t } = this, s = this.world, e = this.colors, l = (a) => a === "road" || a === "cobblestone" || a === "road_cross" || a === "pathway" || a === "floor" || a === "building_floor" || a === "town_stairs", n = (a) => a === "grass" || a === "town_tree" || a === "lamppost" || a === "bench" || a === "flower_bed" || a === "fence" || a === "mailbox" || a === "signpost" || a === "fountain" || a === "market_stall" || a === "well" || a === "crop" || a === "hay_bale" || a === "tree", o = Math.max(2, Math.floor(t * 0.18));
    for (let a = 0; a < s.gridHeight; a++)
      for (let r = 0; r < s.gridWidth; r++) {
        if (!l(s.tiles[a][r].type)) continue;
        const h = r * t, c = a * t, d = this.floorNoise[a * s.gridWidth + r] || 0;
        if (a > 0 && n(s.tiles[a - 1][r].type)) {
          for (let f = 0; f < t; f++) {
            const g = o + Math.sin(f * 1.3 + d * 0.5) * 1.5;
            i.fillStyle = (f + d) % 5 < 3 ? e.floor : e.floorAlt, i.fillRect(h + f, c, 1, Math.max(1, Math.round(g)));
          }
          i.fillStyle = "rgba(0,0,0,0.06)", i.fillRect(h, c + o, t, 1);
        }
        if (a < s.gridHeight - 1 && n(s.tiles[a + 1][r].type)) {
          for (let f = 0; f < t; f++) {
            const g = o + Math.sin(f * 1.1 + d * 0.7) * 1.5;
            i.fillStyle = (f + d) % 5 < 3 ? e.floor : e.floorAlt, i.fillRect(h + f, c + t - Math.round(g), 1, Math.max(1, Math.round(g)));
          }
          i.fillStyle = "rgba(0,0,0,0.06)", i.fillRect(h, c + t - o - 1, t, 1);
        }
        if (r > 0 && n(s.tiles[a][r - 1].type))
          for (let f = 0; f < t; f++) {
            const g = o + Math.sin(f * 1.2 + d * 0.3) * 1.5;
            i.fillStyle = (f + d) % 5 < 3 ? e.floor : e.floorAlt, i.fillRect(h, c + f, Math.max(1, Math.round(g)), 1);
          }
        if (r < s.gridWidth - 1 && n(s.tiles[a][r + 1].type))
          for (let f = 0; f < t; f++) {
            const g = o + Math.sin(f * 0.9 + d * 0.6) * 1.5;
            i.fillStyle = (f + d) % 5 < 3 ? e.floor : e.floorAlt, i.fillRect(h + t - Math.round(g), c + f, Math.max(1, Math.round(g)), 1);
          }
      }
  }
  /** Update which doors are open based on agent proximity (Manhattan distance ≤ 2) */
  updateDoorStates(i) {
    const t = this.world, s = Date.now(), e = 500;
    for (let l = 0; l < t.gridHeight; l++)
      for (let n = 0; n < t.gridWidth; n++) {
        if (t.tiles[l][n].type !== "building_door") continue;
        const o = `${n},${l}`;
        i.some((r) => Math.abs(Math.round(r.x) - n) + Math.abs(Math.round(r.y) - l) <= 2) ? (this.openDoors.add(o), this.doorCloseTimers.delete(o)) : this.openDoors.has(o) && (this.doorCloseTimers.has(o) || this.doorCloseTimers.set(o, s + e), s >= (this.doorCloseTimers.get(o) ?? 0) && (this.openDoors.delete(o), this.doorCloseTimers.delete(o)));
      }
  }
  /** Draw peaked triangular roofs above flat roof tile rows for a classic RPG look */
  drawPeakedRoofs() {
    const { ctx: i, ts: t } = this, s = this.world, e = (o) => o === "building_roof" || o === "building_roof_red" || o === "building_roof_blue" || o === "building_roof_brown" || o === "building_roof_green", l = {
      building_roof: "#6A4A3A",
      building_roof_red: "#B03030",
      building_roof_blue: "#3060A0",
      building_roof_brown: "#8A6A40",
      building_roof_green: "#3A7A3A"
    }, n = /* @__PURE__ */ new Set();
    for (let o = 0; o < s.gridHeight; o++) {
      let a = 0;
      for (; a < s.gridWidth; ) {
        const r = s.tiles[o][a].type;
        if (!e(r)) {
          a++;
          continue;
        }
        if (o > 0 && e(s.tiles[o - 1][a].type)) {
          a++;
          continue;
        }
        const h = `${a},${o}`;
        if (n.has(h)) {
          a++;
          continue;
        }
        const c = a, d = r;
        for (; a < s.gridWidth && e(s.tiles[o][a].type); ) a++;
        const f = a, g = f - c;
        if (g < 3) continue;
        let u = 1;
        for (let F = o + 1; F < s.gridHeight && e(s.tiles[F][c].type); F++)
          u++;
        for (let F = o; F < o + u; F++)
          for (let v = c; v < f; v++)
            n.add(`${v},${F}`);
        const b = l[d] || "#6A4A3A", A = this.lighten(b, 0.12), m = this.darken(b, 0.18), k = this.lighten(b, 0.3), S = this.darken(b, 0.25), w = c * t, M = o * t, p = g * t, R = (o + u) * t, C = t * 0.25, P = Math.max(t * 1.5, p * 0.4), T = w + p / 2, B = M - P;
        i.fillStyle = b, i.fillRect(w, M, p, u * t), i.fillStyle = A, i.beginPath(), i.moveTo(w - C, R), i.lineTo(T, B), i.lineTo(T, R), i.closePath(), i.fill(), i.fillStyle = m, i.beginPath(), i.moveTo(T, B), i.lineTo(w + p + C, R), i.lineTo(T, R), i.closePath(), i.fill();
        const D = Math.max(3, t * 0.25), z = R - B;
        for (let F = D; F < z; F += D) {
          const v = F / z, E = (p / 2 + C) * v, _ = B + F, Y = Math.floor(F / D) % 2 === 0 ? 0 : D * 0.5;
          i.strokeStyle = this.darken(A, 0.08), i.lineWidth = 1, i.beginPath(), i.moveTo(T - E, _), i.lineTo(T, _), i.stroke(), i.strokeStyle = this.darken(m, 0.06), i.beginPath(), i.moveTo(T, _), i.lineTo(T + E, _), i.stroke();
          const K = Math.max(4, t * 0.4);
          for (let W = T - E + Y; W < T; W += K)
            i.strokeStyle = this.darken(A, 0.06), i.beginPath(), i.moveTo(W, _), i.lineTo(W, _ + D * 0.8), i.stroke();
          for (let W = T + Y; W < T + E; W += K)
            i.strokeStyle = this.darken(m, 0.05), i.beginPath(), i.moveTo(W, _), i.lineTo(W, _ + D * 0.8), i.stroke();
        }
        i.strokeStyle = k, i.lineWidth = Math.max(2, this.scale * 0.8), i.beginPath(), i.moveTo(w - C, R), i.lineTo(T, B), i.lineTo(w + p + C, R), i.stroke(), i.fillStyle = k, i.beginPath(), i.moveTo(T - t * 0.15, B + t * 0.1), i.lineTo(T, B - t * 0.05), i.lineTo(T + t * 0.15, B + t * 0.1), i.closePath(), i.fill(), i.fillStyle = S;
        const L = Math.max(2, t * 0.12);
        i.beginPath(), i.moveTo(w - C, R), i.lineTo(w - C, R + L), i.lineTo(T, R + L), i.lineTo(T, R), i.closePath(), i.fill(), i.beginPath(), i.moveTo(T, R), i.lineTo(T, R + L), i.lineTo(w + p + C, R + L), i.lineTo(w + p + C, R), i.closePath(), i.fill();
        const I = i.createLinearGradient(w, R, w, R + t * 0.4);
        if (I.addColorStop(0, "rgba(0,0,0,0.2)"), I.addColorStop(1, "rgba(0,0,0,0)"), i.fillStyle = I, i.fillRect(w - C, R, p + C * 2, t * 0.4), g >= 8) {
          const F = T - t * 0.5, v = t, E = B + z * 0.45, _ = E - t * 0.5;
          i.fillStyle = this.lighten(b, 0.05), i.fillRect(F, E - t * 0.3, v, t * 0.3), i.fillStyle = this.darken(b, 0.1), i.beginPath(), i.moveTo(F - t * 0.1, E - t * 0.3), i.lineTo(F + v / 2, _), i.lineTo(F + v + t * 0.1, E - t * 0.3), i.closePath(), i.fill(), i.fillStyle = "rgba(100,180,255,0.35)", i.fillRect(F + t * 0.2, E - t * 0.25, t * 0.6, t * 0.2), i.strokeStyle = this.darken(b, 0.2), i.lineWidth = 1, i.strokeRect(F + t * 0.2, E - t * 0.25, t * 0.6, t * 0.2);
        }
        for (let F = c; F < f; F++)
          if (s.tiles[o][F].type === "building_chimney") {
            const v = F * t, E = (F - c + 0.5) / g, _ = Math.abs(E - 0.5) * 2, Y = B + z * _;
            i.fillStyle = "#7A6A5A", i.fillRect(v + t * 0.3, Y - t * 0.6, t * 0.4, R - Y + t * 0.6), i.fillStyle = "#8A7A6A", i.fillRect(v + t * 0.22, Y - t * 0.65, t * 0.56, t * 0.1), i.fillStyle = "#6A5A4A", i.fillRect(v + t * 0.25, Y - t * 0.56, t * 0.5, t * 0.04);
          }
      }
    }
  }
  drawWallShadows() {
    const { ctx: i, ts: t } = this, s = this.world, e = Math.max(2, t * 0.12);
    for (let l = 0; l < s.gridHeight; l++)
      for (let n = 0; n < s.gridWidth; n++) {
        const o = s.tiles[l][n].type;
        if (o === "wall" || o === "ship_hull" || o === "empty" || o === "building_wall" || o === "building_roof" || o === "building_roof_red" || o === "building_roof_blue" || o === "building_roof_brown" || o === "building_roof_green" || o === "building_chimney" || o === "building_window" || o === "town_hedge") continue;
        const a = n * t, r = l * t;
        l > 0 && (s.tiles[l - 1][n].type === "wall" || s.tiles[l - 1][n].type === "ship_hull") && (i.fillStyle = "rgba(0,0,0,0.08)", i.fillRect(a, r, t, e)), n > 0 && (s.tiles[l][n - 1].type === "wall" || s.tiles[l][n - 1].type === "ship_hull") && (i.fillStyle = "rgba(0,0,0,0.05)", i.fillRect(a, r, e * 0.7, t));
      }
  }
  drawWallTile(i, t) {
    const { ctx: s, ts: e } = this, l = this.colors;
    this.shadedRect(i, t, e, e, l.wall, { outline: !1, highlightAmt: 0.08, shadowAmt: 0.1 }), s.fillStyle = l.wallTop, s.fillRect(i, t, e, e * 0.28), s.fillStyle = this.lighten(l.wallTop, 0.15), s.fillRect(i, t, e, Math.max(1, e * 0.04)), s.strokeStyle = l.wallBorder, s.lineWidth = 1, s.strokeRect(i + 0.5, t + 0.5, e - 1, e - 1), this.env === "farm" ? (s.fillStyle = l.wallBorder, s.fillRect(i, t + e * 0.45, e, e * 0.08), s.fillStyle = this.darken(l.wallBorder, 0.1), s.fillRect(i, t + e * 0.26, e, e * 0.04), s.fillStyle = this.lighten(l.wallTop, 0.08), s.fillRect(i, t + e * 0.22, e, e * 0.04)) : this.env === "hospital" && (s.fillStyle = this.lighten(l.wallTop, 0.2), s.fillRect(i, t + e * 0.28, e, Math.max(1, e * 0.03)), s.fillStyle = this.lighten(l.wall, 0.06), s.fillRect(i, t + e * 0.5, e, e * 0.06));
  }
  /* ── decorative items ───────────────────────── */
  drawDecor() {
    const i = this.world;
    for (let t = 0; t < i.gridHeight; t++)
      for (let s = 0; s < i.gridWidth; s++) {
        const e = i.tiles[t][s].type;
        if (e === "floor" || e === "wall" || e === "desk" || e === "chair" || e === "rug" || e === "empty" || e === "grass" || e === "road" || e === "road_cross" || e === "cobblestone" || e === "building_floor" || e === "building_wall" || e === "building_roof" || e === "building_roof_red" || e === "building_roof_blue" || e === "building_roof_brown" || e === "building_roof_green" || e === "building_door" || e === "building_chimney" || e === "building_window" || e === "building_awning" || e === "pathway" || e === "town_hedge" || e === "town_stairs") continue;
        const l = s * this.ts, n = t * this.ts;
        switch (e) {
          case "plant":
            this.drawPlant(l, n);
            break;
          case "coffee":
            this.drawCoffee(l, n);
            break;
          case "water_cooler":
            this.drawWaterCooler(l, n);
            break;
          case "bookshelf":
            this.drawBookshelf(l, n);
            break;
          case "couch":
            this.drawCouch(l, n);
            break;
          case "whiteboard":
            this.drawWhiteboard(l, n);
            break;
          case "meeting_table":
            this.drawMeetingTable(l, n);
            break;
          case "cabinet":
            this.drawCabinet(l, n);
            break;
          case "printer":
            this.drawPrinter(l, n);
            break;
          case "rocket_body":
            this.drawRocketBody(l, n);
            break;
          case "rocket_nose":
            this.drawRocketNose(l, n);
            break;
          case "rocket_engine":
            this.drawRocketEngine(l, n);
            break;
          case "scaffolding":
            this.drawScaffolding(l, n);
            break;
          case "fuel_tank":
            this.drawFuelTank(l, n);
            break;
          case "launch_pad":
            this.drawLaunchPad(l, n);
            break;
          case "hull_window":
            this.drawHullWindow(l, n);
            break;
          case "solar_panel":
            this.drawSolarPanel(l, n);
            break;
          case "oxygen_tank":
            this.drawOxygenTank(l, n);
            break;
          case "comm_dish":
            this.drawCommDish(l, n);
            break;
          case "sleep_pod":
            this.drawSleepPod(l, n);
            break;
          case "satellite":
            this.drawSatellite(l, n);
            break;
          case "hay_bale":
            this.drawHayBale(l, n);
            break;
          case "tree":
            this.drawTree(l, n);
            break;
          case "water_trough":
            this.drawWaterTrough(l, n);
            break;
          case "crop":
            this.drawCrop(l, n);
            break;
          case "tractor":
            this.drawTractor(l, n);
            break;
          case "cow":
            this.drawCow(l, n);
            break;
          case "chicken":
            this.drawChicken(l, n);
            break;
          case "sheep":
            this.drawSheep(l, n);
            break;
          case "hospital_bed":
            this.drawHospitalBed(l, n);
            break;
          case "med_cabinet":
            this.drawMedCabinet(l, n);
            break;
          case "xray_machine":
            this.drawXrayMachine(l, n);
            break;
          case "curtain":
            this.drawCurtain(l, n);
            break;
          case "sink":
            this.drawSink(l, n);
            break;
          case "ship_hull":
            this.drawShipHull(l, n);
            break;
          case "ship_mast":
            this.drawShipMast(l, n);
            break;
          case "ship_sail":
            this.drawShipSail(l, n);
            break;
          case "ship_wheel":
            this.drawShipWheel(l, n);
            break;
          case "cannon":
            this.drawCannon(l, n);
            break;
          case "barrel":
            this.drawBarrel(l, n);
            break;
          case "anchor":
            this.drawAnchor(l, n);
            break;
          case "plank":
            this.drawPlankTile(l, n);
            break;
          case "crows_nest":
            this.drawCrowsNest(l, n);
            break;
          case "treasure_chest":
            this.drawTreasureChest(l, n);
            break;
          case "jolly_roger":
            this.drawJollyRoger(l, n);
            break;
          // Town decor
          case "lamppost":
            this.drawLamppost(l, n);
            break;
          case "bench":
            this.drawBench(l, n);
            break;
          case "town_tree":
            this.drawTownTree(l, n);
            break;
          case "fountain":
            this.drawFountain(l, n);
            break;
          case "flower_bed":
            this.drawFlowerBed(l, n);
            break;
          case "fence":
            this.drawFence(l, n);
            break;
          case "mailbox":
            this.drawMailbox(l, n);
            break;
          case "signpost":
            this.drawSignpost(l, n);
            break;
          case "water":
            this.drawWater(l, n);
            break;
          case "market_stall":
            this.drawMarketStall(l, n);
            break;
          case "well":
            this.drawWell(l, n);
            break;
        }
      }
  }
  /* ── office items ───────────────────────────── */
  drawPlant(i, t) {
    const { ts: s } = this, e = this.colors;
    this.shadedRect(i + s * 0.3, t + s * 0.6, s * 0.4, s * 0.35, e.plantPot), this.shadedCircle(i + s * 0.5, t + s * 0.4, s * 0.22, e.plantLeaf), this.shadedCircle(i + s * 0.35, t + s * 0.52, s * 0.16, e.plantLeafAlt, !1), this.shadedCircle(i + s * 0.65, t + s * 0.52, s * 0.16, e.plantLeafAlt, !1);
  }
  drawCoffee(i, t) {
    const { ctx: s, ts: e } = this, l = this.colors;
    this.shadedRect(i + e * 0.2, t + e * 0.25, e * 0.6, e * 0.6, l.coffee), this.shadedRect(i + e * 0.35, t + e * 0.08, e * 0.3, e * 0.2, "#FFFFFF"), s.fillStyle = "#795548", s.fillRect(i + e * 0.4, t + e * 0.12, e * 0.2, e * 0.1);
    const n = Date.now() * 3e-3;
    s.fillStyle = "rgba(255,255,255,0.3)";
    for (let o = 0; o < 2; o++) {
      const a = t + e * 0.04 - Math.sin(n + o * 2) * e * 0.04;
      s.fillRect(i + e * (0.4 + o * 0.12), a, e * 0.04, e * 0.04);
    }
  }
  drawWaterCooler(i, t) {
    const { ctx: s, ts: e } = this, l = this.colors;
    this.shadedRect(i + e * 0.25, t + e * 0.15, e * 0.5, e * 0.7, l.waterCooler), this.shadedRect(i + e * 0.3, t + e * 0.2, e * 0.4, e * 0.25, l.waterCoolerWater, { outline: !1 }), s.fillStyle = this.lighten(l.waterCoolerWater, 0.3), s.fillRect(i + e * 0.3, t + e * 0.2, e * 0.4, Math.max(1, e * 0.03)), this.shadedRect(i + e * 0.38, t + e * 0.7, e * 0.24, e * 0.1, "#CCCCCC"), s.fillStyle = "#999", s.fillRect(i + e * 0.46, t + e * 0.62, e * 0.08, e * 0.1);
  }
  drawBookshelf(i, t) {
    const { ctx: s, ts: e } = this, l = this.colors;
    this.shadedRect(i + 1, t + e * 0.1, e - 2, e * 0.85, l.bookshelf), s.fillStyle = this.darken(l.bookshelf, 0.15), s.fillRect(i + e * 0.1, t + e * 0.48, e * 0.8, Math.max(1, e * 0.03));
    const n = [0.28, 0.3, 0.26, 0.32];
    for (let a = 0; a < 4; a++) {
      const r = e * n[a];
      this.shadedRect(i + e * 0.15 + a * e * 0.18, t + e * 0.48 - r, e * 0.12, r, l.books[a % l.books.length]);
    }
    const o = [0.22, 0.25, 0.2];
    for (let a = 0; a < 3; a++) {
      const r = e * o[a];
      this.shadedRect(i + e * 0.2 + a * e * 0.2, t + e * 0.85 - r, e * 0.14, r, l.books[(a + 2) % l.books.length]);
    }
  }
  drawCouch(i, t) {
    const { ctx: s, ts: e } = this, l = this.colors;
    this.shadedRect(i + e * 0.05, t + e * 0.2, e * 0.9, e * 0.5, l.couch), this.shadedRect(i + e * 0.08, t + e * 0.5, e * 0.84, e * 0.2, this.darken(l.couch, 0.08), { outline: !1 }), this.shadedRect(i + e * 0.05, t + e * 0.65, e * 0.9, e * 0.18, this.darken(l.couch, 0.15)), s.fillStyle = this.darken(l.couch, 0.12), s.fillRect(i + e * 0.47, t + e * 0.25, e * 0.06, e * 0.4), this.shadedRect(i + e * 0.02, t + e * 0.25, e * 0.08, e * 0.45, this.darken(l.couch, 0.05), { outline: !1 }), this.shadedRect(i + e * 0.9, t + e * 0.25, e * 0.08, e * 0.45, this.darken(l.couch, 0.05), { outline: !1 });
  }
  drawWhiteboard(i, t) {
    const { ctx: s, ts: e } = this, l = this.colors;
    this.shadedRect(i + e * 0.08, t + e * 0.12, e * 0.84, e * 0.66, "#AAAAAA"), this.shadedRect(i + e * 0.12, t + e * 0.16, e * 0.76, e * 0.58, l.whiteboard, { shadowAmt: 0.05, highlightAmt: 0.1 }), s.strokeStyle = "#3498DB", s.lineWidth = Math.max(1, this.scale * 0.3), s.beginPath(), s.moveTo(i + e * 0.2, t + e * 0.3), s.lineTo(i + e * 0.7, t + e * 0.3), s.moveTo(i + e * 0.2, t + e * 0.42), s.lineTo(i + e * 0.55, t + e * 0.42), s.moveTo(i + e * 0.2, t + e * 0.54), s.lineTo(i + e * 0.62, t + e * 0.54), s.stroke(), s.fillStyle = "#E74C3C", this.circle(i + e * 0.72, t + e * 0.3, e * 0.025), this.shadedRect(i + e * 0.15, t + e * 0.72, e * 0.7, e * 0.04, "#CCCCCC", { outline: !1 });
  }
  drawMeetingTable(i, t) {
    const { ts: s } = this, e = this.colors;
    this.shadedRect(i + 1, t + 1, s - 2, s - 2, e.meetingTable), this.shadedRect(i + 1, t + s - s * 0.15, s - 2, s * 0.15 - 1, e.meetingTableEdge, { outline: !1 });
  }
  drawCabinet(i, t) {
    const { ctx: s, ts: e } = this, l = this.colors;
    this.shadedRect(i + e * 0.15, t + e * 0.1, e * 0.7, e * 0.8, l.cabinet), s.strokeStyle = this.darken(l.cabinet, 0.15), s.lineWidth = 1;
    for (const n of [0.35, 0.55, 0.75])
      s.beginPath(), s.moveTo(i + e * 0.2, t + e * n), s.lineTo(i + e * 0.8, t + e * n), s.stroke();
    for (const n of [0.28, 0.48, 0.68])
      this.shadedRect(i + e * 0.44, t + e * n, e * 0.12, e * 0.04, "#BBBBBB");
  }
  drawPrinter(i, t) {
    const { ctx: s, ts: e } = this, l = this.colors;
    this.shadedRect(i + e * 0.15, t + e * 0.3, e * 0.7, e * 0.45, l.printer), this.shadedRect(i + e * 0.25, t + e * 0.2, e * 0.5, e * 0.12, "#FFFFFF"), s.fillStyle = this.darken(l.printer, 0.2), s.fillRect(i + e * 0.2, t + e * 0.58, e * 0.6, e * 0.08), s.fillStyle = "#FFF", s.fillRect(i + e * 0.28, t + e * 0.56, e * 0.44, e * 0.04), s.fillStyle = "#27AE60", s.fillRect(i + e * 0.72, t + e * 0.35, e * 0.06, e * 0.04);
  }
  /* ── rocket items ───────────────────────────── */
  drawRocketBody(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.15, t, e * 0.7, e, "#E8E8F0"), s.fillStyle = "#C0C0D0", s.fillRect(i + e * 0.15, t, e * 0.08, e), s.fillRect(i + e * 0.77, t, e * 0.08, e), this.shadedRect(i + e * 0.3, t + e * 0.3, e * 0.4, e * 0.15, "#3366CC"), s.fillStyle = "rgba(255,255,255,0.3)", s.fillRect(i + e * 0.32, t + e * 0.32, e * 0.12, e * 0.06), this.shadedRect(i + e * 0.15, t + e * 0.6, e * 0.7, e * 0.06, "#CC3333", { outline: !1 }), s.fillStyle = "#B0B0C0";
    for (const l of [0.15, 0.5, 0.85])
      s.fillRect(i + e * 0.2, t + e * l, e * 0.03, e * 0.03), s.fillRect(i + e * 0.77, t + e * l, e * 0.03, e * 0.03);
  }
  drawRocketNose(i, t) {
    const { ctx: s, ts: e } = this;
    s.fillStyle = "#CC3333", s.beginPath(), s.moveTo(i + e * 0.5, t + e * 0.05), s.lineTo(i + e * 0.85, t + e * 0.95), s.lineTo(i + e * 0.15, t + e * 0.95), s.closePath(), s.fill(), s.strokeStyle = this.darken("#CC3333", 0.3), s.lineWidth = 1, s.stroke(), s.fillStyle = "#E8E8F0", s.beginPath(), s.moveTo(i + e * 0.5, t + e * 0.3), s.lineTo(i + e * 0.75, t + e * 0.95), s.lineTo(i + e * 0.25, t + e * 0.95), s.closePath(), s.fill(), s.fillStyle = "rgba(255,255,255,0.2)", s.beginPath(), s.moveTo(i + e * 0.48, t + e * 0.32), s.lineTo(i + e * 0.35, t + e * 0.95), s.lineTo(i + e * 0.25, t + e * 0.95), s.closePath(), s.fill();
  }
  drawRocketEngine(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.2, t, e * 0.6, e * 0.5, "#555566"), this.shadedRect(i + e * 0.28, t + e * 0.38, e * 0.44, e * 0.12, "#444455", { outline: !1 });
    const l = Date.now() * 5e-3, n = 0.8 + Math.sin(l) * 0.2;
    s.fillStyle = `rgba(255,102,0,${n.toFixed(2)})`, s.beginPath(), s.moveTo(i + e * 0.25, t + e * 0.5), s.lineTo(i + e * 0.5, t + e * 0.95), s.lineTo(i + e * 0.75, t + e * 0.5), s.closePath(), s.fill(), s.fillStyle = `rgba(255,200,80,${(n * 0.9).toFixed(2)})`, s.beginPath(), s.moveTo(i + e * 0.35, t + e * 0.5), s.lineTo(i + e * 0.5, t + e * 0.8), s.lineTo(i + e * 0.65, t + e * 0.5), s.closePath(), s.fill(), s.fillStyle = `rgba(255,255,200,${(n * 0.7).toFixed(2)})`, s.beginPath(), s.moveTo(i + e * 0.42, t + e * 0.5), s.lineTo(i + e * 0.5, t + e * 0.65), s.lineTo(i + e * 0.58, t + e * 0.5), s.closePath(), s.fill();
  }
  drawScaffolding(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.08, t + e * 0.02, e * 0.08, e * 0.96, "#6A7A8A"), this.shadedRect(i + e * 0.84, t + e * 0.02, e * 0.08, e * 0.96, "#6A7A8A"), s.strokeStyle = "#8899AA", s.lineWidth = Math.max(1, this.scale * 0.5), s.strokeRect(i + e * 0.1, t + e * 0.05, e * 0.8, e * 0.9), s.beginPath(), s.moveTo(i + e * 0.1, t + e * 0.5), s.lineTo(i + e * 0.9, t + e * 0.5), s.stroke(), s.strokeStyle = "#7A8A9A", s.beginPath(), s.moveTo(i + e * 0.16, t + e * 0.05), s.lineTo(i + e * 0.84, t + e * 0.5), s.stroke();
  }
  drawFuelTank(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.2, t + e * 0.15, e * 0.6, e * 0.7, "#338844"), s.fillStyle = "#44AA55", s.fillRect(i + e * 0.25, t + e * 0.2, e * 0.15, e * 0.6), this.shadedRect(i + e * 0.3, t + e * 0.05, e * 0.4, e * 0.12, "#FFCC00"), this.shadedRect(i + e * 0.58, t + e * 0.3, e * 0.15, e * 0.35, "#225533"), s.fillStyle = "#44FF66", s.fillRect(i + e * 0.6, t + e * 0.45, e * 0.11, e * 0.18), s.fillStyle = "#222", s.font = `bold ${Math.max(6, e * 0.18)}px sans-serif`, s.textAlign = "center", s.textBaseline = "middle", s.fillText("FUEL", i + e * 0.42, t + e * 0.55);
  }
  drawLaunchPad(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i, t, e, e, "#555566"), this.shadedRect(i + e * 0.08, t + e * 0.45, e * 0.84, e * 0.1, "#FFCC00", { outline: !1 }), s.fillStyle = "#333344";
    for (let l = 0; l < 4; l++)
      s.fillRect(i + e * (0.12 + l * 0.22), t + e * 0.45, e * 0.08, e * 0.1);
    s.strokeStyle = "#666677", s.lineWidth = 1, s.strokeRect(i + 0.5, t + 0.5, e - 1, e - 1);
  }
  /* ── space station items ────────────────────── */
  drawHullWindow(i, t) {
    const { ctx: s, ts: e } = this, l = Math.round(i / e), n = Math.round(t / e);
    if (this.env === "space_station" && n >= 1 && n <= 2) {
      s.fillStyle = "#020815", s.fillRect(i, t, e, e);
      const r = s.createLinearGradient(i, t, i, t + e);
      r.addColorStop(0, "rgba(10,20,60,0.4)"), r.addColorStop(1, "rgba(5,10,30,0.2)"), s.fillStyle = r, s.fillRect(i, t, e, e);
      const h = Date.now() * 1e-3;
      s.save(), s.beginPath(), s.rect(i + 1, t + 1, e - 2, e - 2), s.clip();
      for (const d of this.warpStars) {
        const f = l * 0.13 + n * 0.37, g = (d.x + f + h * d.speed * 0.4) % 1, u = i + g * e, b = t + d.y * e, A = e * d.len * (0.6 + Math.sin(h * 2 + d.x * 10) * 0.4), m = d.brightness * (0.5 + Math.sin(h * 3 + d.y * 20) * 0.3), k = s.createLinearGradient(u - A, b, u, b);
        k.addColorStop(0, "rgba(100,150,255,0)"), k.addColorStop(0.3, `rgba(150,200,255,${(m * 0.5).toFixed(2)})`), k.addColorStop(1, `rgba(220,240,255,${m.toFixed(2)})`), s.fillStyle = k, s.fillRect(u - A, b - 0.5, A, Math.max(1, e * 0.02)), s.fillStyle = `rgba(255,255,255,${(m * 0.9).toFixed(2)})`, s.fillRect(u - 1, b - 0.5, Math.max(1, e * 0.03), Math.max(1, e * 0.02));
      }
      const c = l * 7 + n * 13;
      for (let d = 0; d < 5; d++) {
        const f = (c + d * 31) % 97 / 97, g = (c + d * 47) % 89 / 89, u = 0.15 + Math.sin(h * 0.5 + d) * 0.08;
        s.fillStyle = `rgba(180,200,255,${u.toFixed(2)})`, s.fillRect(i + f * e, t + g * e, Math.max(1, e * 0.025), Math.max(1, e * 0.025));
      }
      s.restore(), s.strokeStyle = "#1A2A40", s.lineWidth = 0.5, s.strokeRect(i + 0.5, t + 0.5, e - 1, e - 1), n === 1 && (s.fillStyle = "#2A3A4A", s.fillRect(i, t, e, Math.max(1, e * 0.06))), n === 2 && (s.fillStyle = "#2A3A4A", s.fillRect(i, t + e - Math.max(1, e * 0.06), e, Math.max(1, e * 0.06)));
      return;
    }
    this.shadedRect(i + 1, t + 1, e - 2, e - 2, "#1A2535"), this.shadedRect(i + e * 0.15, t + e * 0.15, e * 0.7, e * 0.7, "#0A1020", { highlightAmt: 0.05, shadowAmt: 0.05 }), s.fillStyle = "#FFFFFF", this.circle(i + e * 0.4, t + e * 0.4, e * 0.04), this.circle(i + e * 0.6, t + e * 0.55, e * 0.03), this.circle(i + e * 0.35, t + e * 0.65, e * 0.025), this.circle(i + e * 0.7, t + e * 0.35, e * 0.02), s.fillStyle = "rgba(100,150,255,0.08)", s.fillRect(i + e * 0.18, t + e * 0.18, e * 0.3, e * 0.15), Math.sin(Date.now() * 3e-3) > 0 && (s.fillStyle = "#44FF88", s.fillRect(i + e * 0.8, t + e * 0.85, e * 0.06, e * 0.04)), s.strokeStyle = "#2A3A4A", s.lineWidth = 1, s.strokeRect(i + e * 0.12, t + e * 0.12, e * 0.76, e * 0.76);
  }
  drawSolarPanel(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.05, t + e * 0.15, e * 0.9, e * 0.7, "#1A3A6A"), s.strokeStyle = "#4488CC", s.lineWidth = 1;
    for (let l = 1; l < 4; l++) {
      const n = i + e * 0.05 + e * 0.9 / 4 * l;
      s.beginPath(), s.moveTo(n, t + e * 0.15), s.lineTo(n, t + e * 0.85), s.stroke();
    }
    for (let l = 1; l < 3; l++) {
      const n = t + e * 0.15 + e * 0.7 / 3 * l;
      s.beginPath(), s.moveTo(i + e * 0.05, n), s.lineTo(i + e * 0.95, n), s.stroke();
    }
    s.fillStyle = "rgba(100,180,255,0.1)", s.fillRect(i + e * 0.08, t + e * 0.18, e * 0.22, e * 0.22), this.shadedRect(i + e * 0.45, t + e * 0.05, e * 0.1, e * 0.12, "#CCAA44");
  }
  drawOxygenTank(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.25, t + e * 0.2, e * 0.5, e * 0.65, "#4488CC"), s.fillStyle = "#5599DD", s.fillRect(i + e * 0.3, t + e * 0.25, e * 0.1, e * 0.55), this.shadedRect(i + e * 0.35, t + e * 0.1, e * 0.3, e * 0.12, "#88BBEE"), this.shadedRect(i + e * 0.58, t + e * 0.35, e * 0.12, e * 0.12, "#336699"), s.fillStyle = "#66BBFF", s.fillRect(i + e * 0.6, t + e * 0.38, e * 0.08, e * 0.06), s.fillStyle = "#222", s.font = `bold ${Math.max(5, e * 0.16)}px sans-serif`, s.textAlign = "center", s.textBaseline = "middle", s.fillText("O₂", i + e * 0.43, t + e * 0.55);
  }
  drawCommDish(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.45, t + e * 0.4, e * 0.1, e * 0.55, "#8899AA"), s.fillStyle = "#AABBCC", s.beginPath(), s.moveTo(i + e * 0.15, t + e * 0.6), s.quadraticCurveTo(i + e * 0.5, t + e * 0.1, i + e * 0.85, t + e * 0.6), s.lineTo(i + e * 0.7, t + e * 0.55), s.quadraticCurveTo(i + e * 0.5, t + e * 0.25, i + e * 0.3, t + e * 0.55), s.closePath(), s.fill(), s.strokeStyle = this.darken("#AABBCC", 0.25), s.lineWidth = 1, s.stroke(), s.fillStyle = this.lighten("#AABBCC", 0.15), s.beginPath(), s.moveTo(i + e * 0.25, t + e * 0.55), s.quadraticCurveTo(i + e * 0.4, t + e * 0.3, i + e * 0.55, t + e * 0.5), s.closePath(), s.fill();
    const l = 0.6 + Math.sin(Date.now() * 4e-3) * 0.4;
    s.fillStyle = `rgba(255,68,68,${l.toFixed(2)})`, this.circle(i + e * 0.5, t + e * 0.35, e * 0.06);
  }
  drawSleepPod(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.1, t + e * 0.1, e * 0.8, e * 0.8, "#2A3A4A"), this.shadedRect(i + e * 0.15, t + e * 0.15, e * 0.7, e * 0.5, "#1A2A3A", { outline: !1 }), this.shadedRect(i + e * 0.2, t + e * 0.2, e * 0.25, e * 0.15, "#3A5A7A", { outline: !1 });
    const l = 0.5 + Math.sin(Date.now() * 2e-3) * 0.5;
    s.fillStyle = `rgba(68,170,255,${l.toFixed(2)})`, this.circle(i + e * 0.75, t + e * 0.25, e * 0.04), s.fillStyle = "#354A5E", s.fillRect(i + e * 0.5, t + e * 0.2, e * 0.3, e * 0.1);
  }
  drawSatellite(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.35, t + e * 0.3, e * 0.3, e * 0.4, "#8899AA"), this.shadedRect(i + e * 0.05, t + e * 0.35, e * 0.3, e * 0.2, "#1A3A6A"), this.shadedRect(i + e * 0.65, t + e * 0.35, e * 0.3, e * 0.2, "#1A3A6A"), s.strokeStyle = "#4488CC", s.lineWidth = 1, s.beginPath(), s.moveTo(i + e * 0.2, t + e * 0.35), s.lineTo(i + e * 0.2, t + e * 0.55), s.moveTo(i + e * 0.8, t + e * 0.35), s.lineTo(i + e * 0.8, t + e * 0.55), s.stroke(), s.fillStyle = "rgba(100,180,255,0.1)", s.fillRect(i + e * 0.07, t + e * 0.37, e * 0.12, e * 0.08), s.fillRect(i + e * 0.67, t + e * 0.37, e * 0.12, e * 0.08), s.fillStyle = "#FF4444", this.circle(i + e * 0.5, t + e * 0.25, e * 0.06), this.shadedRect(i + e * 0.45, t + e * 0.68, e * 0.1, e * 0.12, "#CCAA44");
  }
  /* ── farm items ─────────────────────────────── */
  drawHayBale(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.1, t + e * 0.2, e * 0.8, e * 0.65, "#D4A843"), s.fillStyle = "#C09830", s.fillRect(i + e * 0.1, t + e * 0.2, e * 0.8, e * 0.1), s.strokeStyle = "#8B6914", s.lineWidth = Math.max(1, this.scale * 0.4), s.beginPath(), s.moveTo(i + e * 0.35, t + e * 0.2), s.lineTo(i + e * 0.35, t + e * 0.85), s.moveTo(i + e * 0.65, t + e * 0.2), s.lineTo(i + e * 0.65, t + e * 0.85), s.stroke(), s.fillStyle = "#BF9535", s.fillRect(i + e * 0.2, t + e * 0.4, e * 0.08, e * 0.03), s.fillRect(i + e * 0.5, t + e * 0.6, e * 0.06, e * 0.03), s.fillRect(i + e * 0.72, t + e * 0.45, e * 0.05, e * 0.03);
  }
  drawTree(i, t) {
    const { ts: s } = this;
    this.shadedRect(i + s * 0.4, t + s * 0.55, s * 0.2, s * 0.4, "#5A3A1A"), this.shadedCircle(i + s * 0.5, t + s * 0.38, s * 0.3, "#2A8A3A"), this.shadedCircle(i + s * 0.35, t + s * 0.44, s * 0.18, "#3AAA4A", !1), this.shadedCircle(i + s * 0.65, t + s * 0.44, s * 0.18, "#3AAA4A", !1), this.shadedCircle(i + s * 0.5, t + s * 0.28, s * 0.17, "#4ABA5A", !1);
  }
  drawWaterTrough(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.1, t + e * 0.35, e * 0.8, e * 0.45, "#6A6A6A"), this.shadedRect(i + e * 0.15, t + e * 0.4, e * 0.7, e * 0.3, "#5599CC", { outline: !1, highlightAmt: 0.25 });
    const l = Math.sin(Date.now() * 2e-3) * 0.15;
    s.fillStyle = `rgba(200,230,255,${(0.15 + l).toFixed(2)})`, s.fillRect(i + e * 0.2, t + e * 0.42, e * 0.25, e * 0.04), this.shadedRect(i + e * 0.12, t + e * 0.75, e * 0.12, e * 0.15, "#555555"), this.shadedRect(i + e * 0.76, t + e * 0.75, e * 0.12, e * 0.15, "#555555");
  }
  drawCrop(i, t) {
    const { ctx: s, ts: e } = this, l = ["#3A8A2A", "#4A9A3A", "#5AAA4A"];
    s.fillStyle = "#5A4A25", s.fillRect(i + e * 0.08, t + e * 0.82, e * 0.84, e * 0.1);
    for (let n = 0; n < 3; n++) {
      const o = i + e * (0.2 + n * 0.3);
      s.fillStyle = "#6A5A30", s.fillRect(o, t + e * 0.45, e * 0.04, e * 0.4), this.shadedRect(o - e * 0.08, t + e * 0.28, e * 0.2, e * 0.22, l[n], { outline: !1, highlightAmt: 0.15 }), s.fillStyle = this.darken(l[n], 0.1), s.fillRect(o - e * 0.04, t + e * 0.4, e * 0.12, e * 0.08), s.fillStyle = "#CC4444", s.fillRect(o + e * 0.04, t + e * 0.3, e * 0.06, e * 0.06);
    }
  }
  drawTractor(i, t) {
    const { ctx: s, ts: e } = this, l = Date.now() * 2e-3, n = Math.sin(l * 8) * e * 5e-3;
    this.shadedRect(i + e * 0.15, t + e * 0.25 + n, e * 0.55, e * 0.4, "#CC3333"), this.shadedRect(i + e * 0.6, t + e * 0.3 + n, e * 0.25, e * 0.3, "#222222"), this.shadedRect(i + e * 0.52, t + e * 0.15 + n, e * 0.15, e * 0.18, "#AACCEE", { highlightAmt: 0.3 }), s.fillStyle = "#444", s.fillRect(i + e * 0.18, t + e * 0.12 + n, e * 0.06, e * 0.15);
    const o = 0.15 + Math.sin(l * 3) * 0.1, a = t + e * 0.06 - Math.abs(Math.sin(l * 2)) * e * 0.1, r = t + e * 0.02 - Math.abs(Math.sin(l * 2 + 1)) * e * 0.1;
    s.fillStyle = `rgba(180,180,180,${o.toFixed(2)})`, this.circle(i + e * 0.21, a, e * 0.04), s.fillStyle = `rgba(160,160,160,${(o * 0.7).toFixed(2)})`, this.circle(i + e * 0.19, r, e * 0.035);
    const h = l * 3;
    this.shadedCircle(i + e * 0.25, t + e * 0.75, e * 0.15, "#333333"), s.fillStyle = "#555", this.circle(i + e * 0.25, t + e * 0.75, e * 0.07), s.strokeStyle = "#666", s.lineWidth = Math.max(1, e * 0.02);
    for (let c = 0; c < 4; c++) {
      const d = h + Math.PI / 2 * c, f = i + e * 0.25, g = t + e * 0.75, u = e * 0.12;
      s.beginPath(), s.moveTo(f + Math.cos(d) * u * 0.3, g + Math.sin(d) * u * 0.3), s.lineTo(f + Math.cos(d) * u, g + Math.sin(d) * u), s.stroke();
    }
    this.shadedCircle(i + e * 0.7, t + e * 0.72, e * 0.18, "#333333"), s.fillStyle = "#555", this.circle(i + e * 0.7, t + e * 0.72, e * 0.09);
    for (let c = 0; c < 6; c++) {
      const d = h * 0.7 + Math.PI / 3 * c, f = i + e * 0.7, g = t + e * 0.72, u = e * 0.15;
      s.beginPath(), s.moveTo(f + Math.cos(d) * u * 0.3, g + Math.sin(d) * u * 0.3), s.lineTo(f + Math.cos(d) * u, g + Math.sin(d) * u), s.stroke();
    }
  }
  /* ── farm animals ───────────────────────────── */
  drawCow(i, t) {
    const { ctx: s, ts: e } = this, l = Date.now() * 1e-3, n = Math.sin(l * 0.8) * e * 0.015;
    this.shadedRect(i + e * 0.15, t + e * 0.3, e * 0.6, e * 0.35, "#F0F0F0"), s.fillStyle = "#333", s.fillRect(i + e * 0.25, t + e * 0.35, e * 0.15, e * 0.1), s.fillRect(i + e * 0.5, t + e * 0.4, e * 0.1, e * 0.08), this.shadedRect(i + e * 0.06, t + e * 0.25 + n, e * 0.22, e * 0.22, "#F0F0F0"), s.fillStyle = "#1A1A1A", s.fillRect(i + e * 0.12, t + e * 0.3 + n, e * 0.04, e * 0.04), s.fillStyle = "#FFAAAA", s.fillRect(i + e * 0.08, t + e * 0.4 + n, e * 0.12, e * 0.06), s.fillStyle = "#D4C5A0", s.fillRect(i + e * 0.08, t + e * 0.22 + n, e * 0.04, e * 0.05), s.fillRect(i + e * 0.2, t + e * 0.22 + n, e * 0.04, e * 0.05);
    const o = Math.sin(l * 1.2) * e * 0.01;
    this.shadedRect(i + e * 0.2, t + e * 0.65, e * 0.06, e * 0.2 + o, "#444444", { outline: !1 }), this.shadedRect(i + e * 0.4, t + e * 0.65, e * 0.06, e * 0.2 - o, "#444444", { outline: !1 }), this.shadedRect(i + e * 0.55, t + e * 0.65, e * 0.06, e * 0.2 - o, "#444444", { outline: !1 }), this.shadedRect(i + e * 0.65, t + e * 0.65, e * 0.06, e * 0.2 + o, "#444444", { outline: !1 });
    const a = Math.sin(l * 2) * e * 0.04;
    s.fillStyle = "#888", s.fillRect(i + e * 0.74, t + e * 0.33 + a, e * 0.12, e * 0.03), s.fillRect(i + e * 0.82, t + e * 0.34 + a * 1.5, e * 0.06, e * 0.025);
  }
  drawChicken(i, t) {
    const { ctx: s, ts: e } = this, l = Date.now() * 1e-3, a = l * 1.5 % 4 < 0.4 ? e * 0.06 : 0, r = Math.sin(l * 2) * e * 8e-3;
    this.shadedRect(i + e * 0.3, t + e * 0.4 + r, e * 0.35, e * 0.25, "#F5DEB3"), this.shadedCircle(i + e * 0.35, t + e * 0.35 + a + r, e * 0.12, "#F5DEB3", !1), s.fillStyle = "#FF4444", s.fillRect(i + e * 0.3, t + e * 0.22 + a + r, e * 0.1, e * 0.08), s.fillStyle = "#FF8800", s.fillRect(i + e * 0.24, t + e * 0.36 + a + r, e * 0.08, e * 0.04), s.fillStyle = "#1A1A1A", s.fillRect(i + e * 0.32, t + e * 0.32 + a + r, e * 0.03, e * 0.03);
    const h = Math.sin(l * 3) * e * 0.015;
    s.fillStyle = "#CC8800", s.fillRect(i + e * 0.35, t + e * 0.65 + r, e * 0.04, e * 0.15 + h), s.fillRect(i + e * 0.5, t + e * 0.65 + r, e * 0.04, e * 0.15 - h);
    const c = Math.sin(l * 2.5) * e * 0.01;
    s.fillStyle = "#D4A843", s.fillRect(i + e * 0.55, t + e * 0.42 + c + r, e * 0.12, e * 0.06), s.fillStyle = "#C09830", s.fillRect(i + e * 0.6, t + e * 0.48 + c + r, e * 0.1, e * 0.05), s.fillStyle = "#B08820", s.fillRect(i + e * 0.58, t + e * 0.38 - c + r, e * 0.08, e * 0.05);
    const d = Math.sin(l * 4) * e * 5e-3;
    s.fillStyle = this.darken("#F5DEB3", 0.1), s.fillRect(i + e * 0.38, t + e * 0.44 + d + r, e * 0.15, e * 0.12);
  }
  drawSheep(i, t) {
    const { ctx: s, ts: e } = this, l = Date.now() * 1e-3, n = Math.sin(l * 0.7) * e * 0.01, o = Math.sin(l * 1.5) * e * 8e-3;
    this.shadedCircle(i + e * 0.45, t + e * 0.45 + n, e * 0.25 + o, "#F0EAE0", !1), this.shadedCircle(i + e * 0.55, t + e * 0.4 + n, e * 0.2 - o * 0.5, "#F0EAE0", !1), this.shadedCircle(i + e * 0.35, t + e * 0.5 + n, e * 0.18 + o * 0.5, "#F0EAE0", !1), this.shadedCircle(i + e * 0.5, t + e * 0.3 + n, e * 0.12, "#F5EFE5", !1);
    const a = Math.sin(l * 0.5) * e * 0.01;
    this.shadedCircle(i + e * 0.25, t + e * 0.4 + a, e * 0.1, "#3A3A3A"), s.fillStyle = "#1A1A1A", s.fillRect(i + e * 0.22, t + e * 0.38 + a, e * 0.03, e * 0.03);
    const r = Math.sin(l * 3) > 0.9 ? e * 0.01 : 0;
    s.fillStyle = "#3A3A3A", s.fillRect(i + e * 0.18, t + e * 0.35 + a - r, e * 0.04, e * 0.06);
    const h = Math.sin(l * 1) * e * 8e-3;
    this.shadedRect(i + e * 0.3, t + e * 0.65, e * 0.06, e * 0.18 + h, "#555555", { outline: !1 }), this.shadedRect(i + e * 0.5, t + e * 0.65, e * 0.06, e * 0.18 - h, "#555555", { outline: !1 }), this.shadedRect(i + e * 0.38, t + e * 0.67, e * 0.06, e * 0.16 - h, "#555555", { outline: !1 }), this.shadedRect(i + e * 0.58, t + e * 0.67, e * 0.06, e * 0.16 + h, "#555555", { outline: !1 });
  }
  /* ── hospital items ─────────────────────────── */
  drawHospitalBed(i, t) {
    const { ts: s } = this;
    this.shadedRect(i + s * 0.05, t + s * 0.3, s * 0.9, s * 0.5, "#D0D8E0"), this.shadedRect(i + s * 0.1, t + s * 0.35, s * 0.8, s * 0.35, "#E8F0F8", { outline: !1, highlightAmt: 0.15 }), this.shadedRect(i + s * 0.08, t + s * 0.28, s * 0.25, s * 0.12, "#F0F5FF"), this.shadedRect(i + s * 0.05, t + s * 0.25, s * 0.03, s * 0.55, "#A0B0C0"), this.shadedRect(i + s * 0.92, t + s * 0.35, s * 0.03, s * 0.45, "#A0B0C0"), this.shadedRect(i + s * 0.08, t + s * 0.78, s * 0.08, s * 0.12, "#8899AA"), this.shadedRect(i + s * 0.84, t + s * 0.78, s * 0.08, s * 0.12, "#8899AA"), this.shadedRect(i + s * 0.1, t + s * 0.55, s * 0.8, s * 0.08, this.darken("#E8F0F8", 0.05), { outline: !1 });
  }
  drawMedCabinet(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.15, t + e * 0.1, e * 0.7, e * 0.8, "#D0D8E0"), s.strokeStyle = "#B0B8C0", s.lineWidth = 1, s.beginPath(), s.moveTo(i + e * 0.2, t + e * 0.5), s.lineTo(i + e * 0.8, t + e * 0.5), s.stroke(), s.fillStyle = "#E74C3C", s.fillRect(i + e * 0.42, t + e * 0.3, e * 0.16, e * 0.04), s.fillRect(i + e * 0.48, t + e * 0.24, e * 0.04, e * 0.16), s.fillStyle = "#88AACC", s.fillRect(i + e * 0.22, t + e * 0.55, e * 0.06, e * 0.12), s.fillRect(i + e * 0.32, t + e * 0.57, e * 0.05, e * 0.1), s.fillStyle = "#AABB88", s.fillRect(i + e * 0.58, t + e * 0.56, e * 0.06, e * 0.11), this.shadedRect(i + e * 0.45, t + e * 0.72, e * 0.1, e * 0.04, "#AAAAAA");
  }
  drawXrayMachine(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.2, t + e * 0.1, e * 0.6, e * 0.75, "#8899AA"), this.shadedRect(i + e * 0.25, t + e * 0.15, e * 0.5, e * 0.4, "#1A2A3A"), s.fillStyle = "#00BCD4", s.fillRect(i + e * 0.28, t + e * 0.18, e * 0.44, e * 0.34), s.strokeStyle = "#00E5FF", s.lineWidth = 1, s.beginPath(), s.moveTo(i + e * 0.32, t + e * 0.32), s.lineTo(i + e * 0.42, t + e * 0.38), s.lineTo(i + e * 0.52, t + e * 0.28), s.lineTo(i + e * 0.62, t + e * 0.42), s.stroke(), s.fillStyle = "rgba(0,0,0,0.06)";
    for (let l = 0; l < e * 0.34; l += 2)
      s.fillRect(i + e * 0.28, t + e * 0.18 + l, e * 0.44, 1);
    this.shadedRect(i + e * 0.28, t + e * 0.6, e * 0.08, e * 0.06, "#27AE60"), this.shadedRect(i + e * 0.4, t + e * 0.6, e * 0.08, e * 0.06, "#E74C3C"), this.shadedRect(i + e * 0.35, t + e * 0.82, e * 0.3, e * 0.08, "#6A7A8A");
  }
  drawCurtain(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.08, t + e * 0.04, e * 0.54, e * 0.04, "#6A8A9A"), this.shadedRect(i + e * 0.38, t + e * 0.06, e * 0.22, e * 0.88, "#88BBCC", { outline: !1 }), this.shadedRect(i + e * 0.1, t + e * 0.06, e * 0.35, e * 0.88, "#99CCDD", { outline: !1, highlightAmt: 0.1 }), s.fillStyle = "#77AABB", s.fillRect(i + e * 0.2, t + e * 0.1, e * 0.02, e * 0.82), s.fillRect(i + e * 0.32, t + e * 0.1, e * 0.02, e * 0.82);
    for (let l = 0; l < 4; l++)
      s.fillRect(i + e * 0.12, t + e * (0.15 + l * 0.2), e * 0.3, e * 0.02);
  }
  drawSink(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.15, t + e * 0.3, e * 0.7, e * 0.45, "#D0D8E0"), this.shadedRect(i + e * 0.2, t + e * 0.35, e * 0.6, e * 0.3, "#E8F0F8", { outline: !1 }), s.fillStyle = "#88AACC", s.fillRect(i + e * 0.25, t + e * 0.4, e * 0.5, e * 0.2), s.fillStyle = "rgba(200,230,255,0.2)", s.fillRect(i + e * 0.3, t + e * 0.42, e * 0.15, e * 0.04), this.shadedRect(i + e * 0.44, t + e * 0.15, e * 0.12, e * 0.18, "#AABBCC"), this.shadedCircle(i + e * 0.4, t + e * 0.16, e * 0.04, "#CC4444"), this.shadedCircle(i + e * 0.6, t + e * 0.16, e * 0.04, "#4444CC"), s.fillStyle = "#777", this.circle(i + e * 0.5, t + e * 0.55, e * 0.03);
  }
  /* ── pirate ship items ────────────────────────── */
  drawShipHull(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i, t, e, e, "#5A3A1A", { highlightAmt: 0.1 }), s.fillStyle = "#6B4423", s.fillRect(i + 1, t + 1, e - 2, e * 0.12), s.strokeStyle = "#4A2A0A", s.lineWidth = 1, s.beginPath(), s.moveTo(i + 1, t + e * 0.33), s.lineTo(i + e - 1, t + e * 0.33), s.moveTo(i + 1, t + e * 0.66), s.lineTo(i + e - 1, t + e * 0.66), s.stroke(), s.fillStyle = "#4A2A0A", s.fillRect(i + e * 0.25, t + e * 0.2, e * 0.04, e * 0.03), s.fillRect(i + e * 0.7, t + e * 0.5, e * 0.04, e * 0.03), s.fillRect(i + e * 0.4, t + e * 0.78, e * 0.04, e * 0.03), s.fillStyle = "#888", s.fillRect(i + e * 0.15, t + e * 0.46, e * 0.03, e * 0.03), s.fillRect(i + e * 0.82, t + e * 0.46, e * 0.03, e * 0.03);
  }
  drawShipMast(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.4, t, e * 0.2, e, "#6B4423"), s.fillStyle = "#5A3A1A", s.fillRect(i + e * 0.42, t, e * 0.04, e), s.fillStyle = "#555", s.fillRect(i + e * 0.38, t + e * 0.2, e * 0.24, e * 0.03), s.fillRect(i + e * 0.38, t + e * 0.7, e * 0.24, e * 0.03);
  }
  drawShipSail(i, t) {
    const { ctx: s, ts: e } = this, l = Date.now() * 1e-3, n = Math.sin(l) * e * 0.05;
    s.fillStyle = "#F0E8D0", s.beginPath(), s.moveTo(i + e * 0.05, t + e * 0.1), s.quadraticCurveTo(i + e * 0.5 + n, t + e * 0.5, i + e * 0.05, t + e * 0.9), s.lineTo(i + e * 0.95, t + e * 0.9), s.quadraticCurveTo(i + e * 0.5 + n, t + e * 0.5, i + e * 0.95, t + e * 0.1), s.closePath(), s.fill(), s.strokeStyle = this.darken("#F0E8D0", 0.25), s.lineWidth = 1, s.stroke(), s.fillStyle = "rgba(0,0,0,0.05)", s.beginPath(), s.moveTo(i + e * 0.55, t + e * 0.1), s.quadraticCurveTo(i + e * 0.5 + n, t + e * 0.5, i + e * 0.55, t + e * 0.9), s.lineTo(i + e * 0.95, t + e * 0.9), s.quadraticCurveTo(i + e * 0.5 + n, t + e * 0.5, i + e * 0.95, t + e * 0.1), s.closePath(), s.fill(), s.strokeStyle = "#C0B090", s.lineWidth = 1, s.beginPath(), s.moveTo(i + e * 0.3, t + e * 0.1), s.lineTo(i + e * 0.3, t + e * 0.9), s.moveTo(i + e * 0.5, t + e * 0.12), s.lineTo(i + e * 0.5, t + e * 0.88), s.moveTo(i + e * 0.7, t + e * 0.1), s.lineTo(i + e * 0.7, t + e * 0.9), s.stroke(), s.fillStyle = "#E0D8C0", s.fillRect(i + e * 0.6, t + e * 0.4, e * 0.12, e * 0.15);
  }
  drawShipWheel(i, t) {
    const { ctx: s, ts: e } = this, l = i + e * 0.5, n = t + e * 0.5, o = e * 0.3;
    s.strokeStyle = "#6B4423", s.lineWidth = Math.max(2, this.scale * 0.6), s.beginPath(), s.arc(l, n, o, 0, Math.PI * 2), s.stroke();
    for (let a = 0; a < 8; a++) {
      const r = a / 8 * Math.PI * 2;
      s.beginPath(), s.moveTo(l, n), s.lineTo(l + Math.cos(r) * o * 1.2, n + Math.sin(r) * o * 1.2), s.stroke();
    }
    s.fillStyle = "#8B6914", this.circle(l, n, e * 0.06);
  }
  drawCannon(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.15, t + e * 0.35, e * 0.7, e * 0.25, "#333333"), this.shadedRect(i + e * 0.1, t + e * 0.32, e * 0.12, e * 0.3, "#444444"), s.fillStyle = "#222", this.circle(i + e * 0.78, t + e * 0.4, e * 0.03), this.shadedCircle(i + e * 0.3, t + e * 0.7, e * 0.1, "#5A3A1A"), this.shadedCircle(i + e * 0.7, t + e * 0.7, e * 0.1, "#5A3A1A"), s.fillStyle = "#4A2A0A", this.circle(i + e * 0.3, t + e * 0.7, e * 0.04), this.circle(i + e * 0.7, t + e * 0.7, e * 0.04);
  }
  drawBarrel(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.2, t + e * 0.15, e * 0.6, e * 0.7, "#8B6914"), this.shadedRect(i + e * 0.15, t + e * 0.25, e * 0.7, e * 0.06, "#6B5020", { outline: !1 }), this.shadedRect(i + e * 0.15, t + e * 0.6, e * 0.7, e * 0.06, "#6B5020", { outline: !1 }), s.fillStyle = "#7A5A0A", s.fillRect(i + e * 0.22, t + e * 0.15, e * 0.56, e * 0.1), s.fillStyle = this.darken("#8B6914", 0.1), s.fillRect(i + e * 0.35, t + e * 0.35, e * 0.03, e * 0.2), s.fillRect(i + e * 0.55, t + e * 0.4, e * 0.03, e * 0.15);
  }
  drawAnchor(i, t) {
    const { ctx: s, ts: e } = this, l = i + e * 0.5, n = t + e * 0.15;
    s.strokeStyle = "#555", s.lineWidth = Math.max(2, this.scale * 0.5), s.beginPath(), s.moveTo(l, n), s.lineTo(l, t + e * 0.7), s.stroke(), s.beginPath(), s.moveTo(l - e * 0.2, n + e * 0.15), s.lineTo(l + e * 0.2, n + e * 0.15), s.stroke(), s.beginPath(), s.arc(l, t + e * 0.7, e * 0.2, 0, Math.PI), s.stroke(), s.beginPath(), s.arc(l, n, e * 0.06, 0, Math.PI * 2), s.stroke();
  }
  drawPlankTile(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i, t + e * 0.35, e, e * 0.3, "#A08050"), s.fillStyle = this.darken("#A08050", 0.08), s.fillRect(i + e * 0.1, t + e * 0.42, e * 0.8, e * 0.02), s.fillRect(i + e * 0.2, t + e * 0.52, e * 0.6, e * 0.02);
  }
  drawCrowsNest(i, t) {
    const { ts: s } = this;
    this.shadedRect(i + s * 0.4, t + s * 0.3, s * 0.2, s * 0.7, "#6B4423"), this.shadedRect(i + s * 0.1, t + s * 0.5, s * 0.8, s * 0.12, "#8B6914"), this.shadedRect(i + s * 0.1, t + s * 0.3, s * 0.06, s * 0.22, "#6B4423", { outline: !1 }), this.shadedRect(i + s * 0.84, t + s * 0.3, s * 0.06, s * 0.22, "#6B4423", { outline: !1 }), this.shadedRect(i + s * 0.1, t + s * 0.3, s * 0.8, s * 0.04, "#6B4423", { outline: !1 });
  }
  drawTreasureChest(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.15, t + e * 0.3, e * 0.7, e * 0.5, "#8B6914"), this.shadedRect(i + e * 0.15, t + e * 0.3, e * 0.7, e * 0.15, "#6B5020", { outline: !1 }), this.shadedRect(i + e * 0.15, t + e * 0.42, e * 0.7, e * 0.04, "#FFCC00", { outline: !1 }), this.shadedRect(i + e * 0.42, t + e * 0.3, e * 0.16, e * 0.2, "#FFCC00", { outline: !1 }), this.shadedCircle(i + e * 0.5, t + e * 0.42, e * 0.05, "#FFD700"), s.fillStyle = "#333", s.fillRect(i + e * 0.49, t + e * 0.41, e * 0.03, e * 0.04), this.shadedCircle(i + e * 0.35, t + e * 0.28, e * 0.04, "#FFD700", !1), this.shadedCircle(i + e * 0.55, t + e * 0.26, e * 0.035, "#FFD700", !1), this.shadedCircle(i + e * 0.65, t + e * 0.29, e * 0.03, "#FFD700", !1), Math.sin(Date.now() * 5e-3) > 0.7 && (s.fillStyle = "rgba(255,255,200,0.8)", s.fillRect(i + e * 0.4, t + e * 0.26, e * 0.03, e * 0.03));
  }
  drawJollyRoger(i, t) {
    const { ctx: s, ts: e } = this;
    this.shadedRect(i + e * 0.45, t, e * 0.1, e, "#6B4423");
    const l = Math.sin(Date.now() * 2e-3) * e * 0.02;
    s.fillStyle = "#1A1A1A", s.beginPath(), s.moveTo(i + e * 0.55, t + e * 0.1), s.quadraticCurveTo(i + e * 0.75, t + e * 0.18 + l, i + e * 0.95, t + e * 0.1), s.lineTo(i + e * 0.95, t + e * 0.4), s.quadraticCurveTo(i + e * 0.75, t + e * 0.35 - l, i + e * 0.55, t + e * 0.4), s.closePath(), s.fill(), s.strokeStyle = "#333", s.lineWidth = 1, s.stroke(), s.fillStyle = "#F0F0F0", this.circle(i + e * 0.72, t + e * 0.2, e * 0.06), s.fillStyle = "#1A1A1A", s.fillRect(i + e * 0.69, t + e * 0.19, e * 0.03, e * 0.02), s.fillRect(i + e * 0.74, t + e * 0.19, e * 0.03, e * 0.02), s.strokeStyle = "#F0F0F0", s.lineWidth = Math.max(1, this.scale * 0.3), s.beginPath(), s.moveTo(i + e * 0.62, t + e * 0.28), s.lineTo(i + e * 0.82, t + e * 0.36), s.moveTo(i + e * 0.82, t + e * 0.28), s.lineTo(i + e * 0.62, t + e * 0.36), s.stroke();
  }
  /* ── town items ──────────────────────────────── */
  drawGrassBase(i, t) {
    const { ctx: s, ts: e } = this, l = this.colors, n = Math.floor(i / e), o = Math.floor(t / e), a = [l.floor, l.floorAlt, this.darken(l.floor, 0.04)];
    s.fillStyle = a[(n * 7 + o * 13) % 3], s.fillRect(i, t, e, e);
    const r = this.floorNoise[o * this.world.gridWidth + n] || 0;
    r % 3 === 0 && (s.fillStyle = this.darken(l.floor, 0.12), s.fillRect(i + r * 3 % e, t + r * 7 % e, 1, 1));
  }
  drawLamppost(i, t) {
    const { ctx: s, ts: e } = this;
    this.drawGrassBase(i, t), this.drawGroundShadow(i, t, 0.2);
    const l = Math.max(2, e * 0.08);
    this.shadedRect(i + e * 0.46, t + e * 0.25, l, e * 0.7, "#333333", { outline: !1 }), this.shadedRect(i + e * 0.35, t + e * 0.85, e * 0.3, e * 0.1, "#444444"), this.shadedRect(i + e * 0.35, t + e * 0.18, e * 0.3, e * 0.12, "#444444");
    const n = e * 0.18, o = i + e * 0.5, a = t + e * 0.2;
    s.fillStyle = "rgba(255,220,100,0.25)", s.beginPath(), s.arc(o, a, n * 2, 0, Math.PI * 2), s.fill(), s.fillStyle = "#FFDD66", s.beginPath(), s.arc(o, a, n * 0.6, 0, Math.PI * 2), s.fill();
  }
  drawBench(i, t) {
    const { ts: s } = this;
    this.drawGrassBase(i, t), this.drawGroundShadow(i, t, 0.35), this.shadedRect(i + s * 0.15, t + s * 0.55, s * 0.08, s * 0.3, "#6B4423", { outline: !1 }), this.shadedRect(i + s * 0.77, t + s * 0.55, s * 0.08, s * 0.3, "#6B4423", { outline: !1 }), this.shadedRect(i + s * 0.1, t + s * 0.48, s * 0.8, s * 0.12, "#8B6914"), this.shadedRect(i + s * 0.1, t + s * 0.3, s * 0.8, s * 0.08, "#7A5A0A"), this.shadedRect(i + s * 0.15, t + s * 0.3, s * 0.06, s * 0.25, "#6B4423", { outline: !1 }), this.shadedRect(i + s * 0.79, t + s * 0.3, s * 0.06, s * 0.25, "#6B4423", { outline: !1 });
  }
  /** Draw a small ground shadow ellipse at the base of a decoration */
  drawGroundShadow(i, t, s = 0.35) {
    const { ctx: e, ts: l } = this;
    e.fillStyle = "rgba(0,0,0,0.08)", e.beginPath(), e.ellipse(i + l * 0.5, t + l * 0.92, l * s, l * 0.06, 0, 0, Math.PI * 2), e.fill();
  }
  drawTownTree(i, t) {
    const { ts: s } = this, e = this.colors;
    this.drawGrassBase(i, t), this.drawGroundShadow(i, t, 0.38), this.shadedRect(i + s * 0.38, t + s * 0.5, s * 0.24, s * 0.45, "#5A3A1A");
    const l = Math.sin(Date.now() * 1e-3 + i * 0.5) * s * 0.01;
    this.shadedCircle(i + s * 0.5 + l, t + s * 0.3, s * 0.35, e.plantLeaf), this.shadedCircle(i + s * 0.32 + l, t + s * 0.38, s * 0.22, e.plantLeafAlt, !1), this.shadedCircle(i + s * 0.68 + l, t + s * 0.38, s * 0.22, e.plantLeafAlt, !1), this.shadedCircle(i + s * 0.5 + l, t + s * 0.18, s * 0.2, this.lighten(e.plantLeaf, 0.1), !1);
  }
  drawFountain(i, t) {
    const { ctx: s, ts: e } = this;
    this.drawGrassBase(i, t), this.drawGroundShadow(i, t, 0.4), this.shadedRect(i + e * 0.1, t + e * 0.2, e * 0.8, e * 0.7, "#8A8A8A"), this.shadedRect(i + e * 0.18, t + e * 0.28, e * 0.64, e * 0.54, "#7A7A7A", { outline: !1 }), s.fillStyle = "#5599CC", s.fillRect(i + e * 0.22, t + e * 0.32, e * 0.56, e * 0.46);
    const l = Math.sin(Date.now() * 3e-3) * 0.2;
    s.fillStyle = `rgba(200,240,255,${(0.25 + l).toFixed(2)})`, s.fillRect(i + e * 0.28, t + e * 0.38, e * 0.2, e * 0.06);
    const n = Math.sin(Date.now() * 3e-3 + 1.5) * 0.15;
    s.fillStyle = `rgba(200,240,255,${(0.2 + n).toFixed(2)})`, s.fillRect(i + e * 0.52, t + e * 0.52, e * 0.18, e * 0.05), this.shadedRect(i + e * 0.44, t + e * 0.35, e * 0.12, e * 0.25, "#999999");
    const o = e * 0.12 + Math.sin(Date.now() * 5e-3) * e * 0.04;
    s.fillStyle = "rgba(150,210,255,0.5)", s.fillRect(i + e * 0.47, t + e * 0.35 - o, e * 0.06, o);
  }
  drawFlowerBed(i, t) {
    const { ctx: s, ts: e } = this;
    this.drawGrassBase(i, t), this.drawGroundShadow(i, t, 0.3), s.fillStyle = "#5A4A25", s.fillRect(i + e * 0.1, t + e * 0.65, e * 0.8, e * 0.25);
    const l = ["#E74C3C", "#F1C40F", "#FF69B4", "#3498DB"], n = [
      [0.2, 0.45],
      [0.45, 0.4],
      [0.7, 0.48],
      [0.55, 0.55]
    ];
    for (let o = 0; o < 4; o++)
      s.fillStyle = "#3A7A2A", s.fillRect(i + e * n[o][0], t + e * n[o][1], e * 0.04, e * 0.25), s.fillStyle = l[o], this.circle(i + e * (n[o][0] + 0.02), t + e * n[o][1], e * 0.06);
    s.fillStyle = "#4A8A3A", s.fillRect(i + e * 0.15, t + e * 0.58, e * 0.08, e * 0.05), s.fillRect(i + e * 0.62, t + e * 0.56, e * 0.08, e * 0.05);
  }
  drawFence(i, t) {
    const { ctx: s, ts: e } = this;
    this.drawGrassBase(i, t), this.shadedRect(i + e * 0.1, t + e * 0.2, e * 0.1, e * 0.65, "#8B6914"), this.shadedRect(i + e * 0.8, t + e * 0.2, e * 0.1, e * 0.65, "#8B6914"), s.fillStyle = "#A07820", s.fillRect(i + e * 0.08, t + e * 0.15, e * 0.14, e * 0.08), s.fillRect(i + e * 0.78, t + e * 0.15, e * 0.14, e * 0.08), this.shadedRect(i, t + e * 0.35, e, e * 0.06, "#A08050", { outline: !1 }), this.shadedRect(i, t + e * 0.6, e, e * 0.06, "#A08050", { outline: !1 });
  }
  drawMailbox(i, t) {
    const { ctx: s, ts: e } = this;
    this.drawGrassBase(i, t), this.drawGroundShadow(i, t, 0.2), this.shadedRect(i + e * 0.44, t + e * 0.45, e * 0.12, e * 0.5, "#6B4423", { outline: !1 }), this.shadedRect(i + e * 0.25, t + e * 0.2, e * 0.5, e * 0.3, "#2980B9"), this.shadedRect(i + e * 0.22, t + e * 0.16, e * 0.56, e * 0.08, "#3498DB"), s.fillStyle = "#1A5276", s.fillRect(i + e * 0.35, t + e * 0.32, e * 0.3, e * 0.04), s.fillStyle = "#E74C3C", s.fillRect(i + e * 0.72, t + e * 0.2, e * 0.04, e * 0.15), s.fillRect(i + e * 0.72, t + e * 0.2, e * 0.12, e * 0.06);
  }
  drawSignpost(i, t) {
    const { ctx: s, ts: e } = this;
    this.drawGrassBase(i, t), this.drawGroundShadow(i, t, 0.2), this.shadedRect(i + e * 0.44, t + e * 0.15, e * 0.12, e * 0.8, "#6B4423"), this.shadedRect(i + e * 0.2, t + e * 0.2, e * 0.55, e * 0.15, "#A08050"), s.fillStyle = "#A08050", s.beginPath(), s.moveTo(i + e * 0.75, t + e * 0.2), s.lineTo(i + e * 0.88, t + e * 0.275), s.lineTo(i + e * 0.75, t + e * 0.35), s.closePath(), s.fill(), s.fillStyle = "#3A2A1A", s.fillRect(i + e * 0.25, t + e * 0.26, e * 0.35, e * 0.03);
  }
  drawWater(i, t) {
    const { ctx: s, ts: e } = this, l = "#4488AA";
    s.fillStyle = l, s.fillRect(i, t, e, e);
    const n = Date.now() * 2e-3;
    s.fillStyle = this.lighten(l, 0.1);
    for (let a = 0; a < 3; a++) {
      const r = Math.sin(n + a * 2) * e * 0.08, h = t + e * (0.2 + a * 0.3);
      s.fillRect(i + e * 0.1 + r, h, e * 0.3, e * 0.04);
    }
    const o = Math.sin(n * 1.5) * 0.15;
    s.fillStyle = `rgba(200,240,255,${(0.15 + o).toFixed(2)})`, s.fillRect(i + e * 0.5, t + e * 0.35, e * 0.2, e * 0.06), s.fillStyle = `rgba(200,240,255,${(0.1 + o).toFixed(2)})`, s.fillRect(i + e * 0.2, t + e * 0.65, e * 0.15, e * 0.05), s.strokeStyle = this.darken(l, 0.15), s.lineWidth = 1, s.strokeRect(i + 0.5, t + 0.5, e - 1, e - 1);
  }
  drawMarketStall(i, t) {
    const { ctx: s, ts: e } = this;
    this.drawGrassBase(i, t), this.drawGroundShadow(i, t, 0.4), this.shadedRect(i + e * 0.05, t + e * 0.5, e * 0.9, e * 0.35, "#8B6914");
    const l = ["#E74C3C", "#F39C12", "#27AE60", "#3498DB"];
    for (let a = 0; a < 4; a++) {
      s.fillStyle = l[a];
      const r = i + e * (0.1 + a * 0.2);
      s.fillRect(r, t + e * 0.42, e * 0.14, e * 0.12);
    }
    const n = e * 0.25, o = Math.max(2, Math.floor(e / 5));
    for (let a = 0; a < e; a += o * 2)
      s.fillStyle = "#CC4444", s.fillRect(i + a, t + e * 0.15, o, n), s.fillStyle = "#EEEECC", s.fillRect(i + a + o, t + e * 0.15, o, n);
    s.fillStyle = "rgba(0,0,0,0.1)", s.fillRect(i, t + e * 0.15 + n, e, e * 0.04), this.shadedRect(i + e * 0.08, t + e * 0.15, e * 0.06, e * 0.7, "#6B4423", { outline: !1 }), this.shadedRect(i + e * 0.86, t + e * 0.15, e * 0.06, e * 0.7, "#6B4423", { outline: !1 });
  }
  drawWell(i, t) {
    const { ctx: s, ts: e } = this;
    this.drawGrassBase(i, t), this.drawGroundShadow(i, t, 0.35), this.shadedRect(i + e * 0.15, t + e * 0.3, e * 0.7, e * 0.55, "#8A8A7A"), s.fillStyle = "#2A3A5A", s.fillRect(i + e * 0.22, t + e * 0.38, e * 0.56, e * 0.4);
    const l = Math.sin(Date.now() * 2e-3) * 0.15;
    s.fillStyle = `rgba(100,150,200,${(0.2 + l).toFixed(2)})`, s.fillRect(i + e * 0.28, t + e * 0.48, e * 0.2, e * 0.06), this.shadedRect(i + e * 0.15, t + e * 0.15, e * 0.06, e * 0.6, "#5A3A1A", { outline: !1 }), this.shadedRect(i + e * 0.79, t + e * 0.15, e * 0.06, e * 0.6, "#5A3A1A", { outline: !1 }), this.shadedRect(i + e * 0.15, t + e * 0.12, e * 0.7, e * 0.06, "#6B4423"), s.fillStyle = "#A09060", s.fillRect(i + e * 0.48, t + e * 0.18, e * 0.04, e * 0.25), this.shadedRect(i + e * 0.42, t + e * 0.4, e * 0.16, e * 0.1, "#7A7A7A");
  }
  /* ── workstations (env-specific) ────────────── */
  drawWorkstations() {
    this.drawZones();
  }
  /** Map zone types to visual variants */
  getZoneVariant(i) {
    switch (i) {
      case "desk":
      case "reception":
        return "office";
      case "patient_station":
      case "lab_bench":
        return "medical";
      case "control_panel":
      case "bridge_console":
      case "science_lab":
      case "engineering":
        return "console";
      case "nav_table":
        return "pirate";
      case "tool_bench":
      case "barn_workshop":
      case "workshop_bench":
        return "workbench";
      case "shop_counter":
        return "office";
      default:
        return "workbench";
    }
  }
  drawZones() {
    var e, l;
    const { ctx: i, ts: t } = this, s = this.colors;
    for (const n of this.world.zones)
      if (G.DESK_ZONES.has(n.type)) {
        const a = n.position.y - 1, r = n.position.x;
        if (a >= 0)
          for (let b = 0; b < 2; b++) {
            const A = r + b;
            if (A < this.world.gridWidth && ((l = (e = this.world.tiles[a]) == null ? void 0 : e[A]) == null ? void 0 : l.type) === "desk") {
              const m = A * t, k = a * t;
              this.shadedRect(m + 1, k + t * 0.2, t - 2, t * 0.55, s.deskTop), this.shadedRect(m + 1, k + t * 0.7, t - 2, t * 0.2, s.deskEdge, { outline: !1 }), this.shadedRect(m + 2, k + t * 0.85, t * 0.12, t * 0.15, s.deskLeg, { outline: !1 }), this.shadedRect(m + t - 2 - t * 0.12, k + t * 0.85, t * 0.12, t * 0.15, s.deskLeg, { outline: !1 });
            }
          }
        const h = r * t, c = a * t, d = this.getZoneVariant(n.type);
        if (d === "office" || d === "medical") {
          const b = h + t * 0.2, A = c + t * 0.02, m = t * 0.55, k = t * 0.35;
          this.shadedRect(b, A, m, k, s.monitor), i.fillStyle = n.assignedAgentId ? s.screenOn : s.screenOff, i.fillRect(b + 2, A + 2, m - 4, k - 4), n.assignedAgentId && this.drawScreenContent(b + 2, A + 2, m - 4, k - 4, n.assignedAgentId, d === "medical"), this.shadedRect(b + m * 0.35, A + k, m * 0.3, t * 0.06, s.monitor, { outline: !1 }), i.fillStyle = this.darken(s.monitor, 0.1), i.fillRect(b + m * 0.25, A + k + t * 0.05, m * 0.5, t * 0.03), d === "medical" && (i.fillStyle = "#E74C3C", i.fillRect(b + m * 0.35, A + k * 0.3, m * 0.3, m * 0.04), i.fillRect(b + m * 0.48, A + k * 0.15, m * 0.04, m * 0.3));
        } else if (d === "console") {
          if (this.shadedRect(h + t * 0.1, c + t * 0.05, t * 0.8, t * 0.25, "#1A2A3A"), i.fillStyle = n.assignedAgentId ? "#44AAFF" : "#0A1520", i.fillRect(h + t * 0.15, c + t * 0.08, t * 0.7, t * 0.18), n.assignedAgentId && this.drawScreenContent(h + t * 0.15, c + t * 0.08, t * 0.7, t * 0.18, n.assignedAgentId, !1), n.assignedAgentId) {
            const b = 0.5 + Math.sin(Date.now() * 3e-3) * 0.5;
            i.fillStyle = `rgba(68,170,85,${b.toFixed(2)})`;
          } else
            i.fillStyle = "#333";
          this.circle(h + t * 0.85, c + t * 0.16, t * 0.03), i.fillStyle = "#445566", i.fillRect(h + t * 0.15, c + t * 0.27, t * 0.08, t * 0.04), i.fillRect(h + t * 0.28, c + t * 0.27, t * 0.08, t * 0.04);
        } else if (d === "pirate") {
          this.shadedRect(h + t * 0.1, c + t * 0.05, t * 0.7, t * 0.25, "#D4C5A0"), i.fillStyle = "#8B6914", i.fillRect(h + t * 0.2, c + t * 0.12, t * 0.15, t * 0.02), i.fillRect(h + t * 0.4, c + t * 0.18, t * 0.2, t * 0.02), i.strokeStyle = "#CC3333", i.lineWidth = 1, i.beginPath(), i.moveTo(h + t * 0.55, c + t * 0.1), i.lineTo(h + t * 0.62, c + t * 0.17), i.moveTo(h + t * 0.62, c + t * 0.1), i.lineTo(h + t * 0.55, c + t * 0.17), i.stroke(), i.fillStyle = "#F0E0C0", i.fillRect(h + t * 0.78, c + t * 0.12, t * 0.08, t * 0.15);
          const b = 0.7 + Math.sin(Date.now() * 8e-3) * 0.3;
          i.fillStyle = `rgba(255,200,50,${b.toFixed(2)})`, this.circle(h + t * 0.82, c + t * 0.1, t * 0.04), i.fillStyle = `rgba(255,100,20,${(b * 0.6).toFixed(2)})`, this.circle(h + t * 0.82, c + t * 0.08, t * 0.025);
        } else
          this.shadedRect(h + t * 0.15, c + t * 0.08, t * 0.3, t * 0.12, "#888888"), this.shadedRect(h + t * 0.55, c + t * 0.1, t * 0.2, t * 0.08, "#888888"), i.fillStyle = "#AAA", i.fillRect(h + t * 0.6, c + t * 0.06, t * 0.1, t * 0.04);
        const f = n.position, g = f.x * t, u = f.y * t;
        this.shadedRect(g + t * 0.2, u + t * 0.3, t * 0.6, t * 0.4, s.chairSeat), this.shadedRect(g + t * 0.2, u + t * 0.65, t * 0.6, t * 0.15, s.chairBack), i.fillStyle = this.darken(s.chairBack, 0.2), i.fillRect(g + t * 0.22, u + t * 0.8, t * 0.04, t * 0.12), i.fillRect(g + t * 0.74, u + t * 0.8, t * 0.04, t * 0.12);
      }
    this.drawRoomWalls();
  }
  drawRoomWalls() {
    const { ts: i } = this, t = this.colors;
    for (let s = 0; s < this.world.gridHeight; s++)
      for (let e = 1; e < this.world.gridWidth - 1; e++)
        if (this.world.tiles[s][e].type === "wall" && s > 0 && s < this.world.gridHeight - 1 && e > 0 && e < this.world.gridWidth - 1) {
          const n = s === 0, o = s === this.world.gridHeight - 1, a = e === 0, r = e === this.world.gridWidth - 1;
          if (!n && !o && !a && !r) {
            const h = e * i, c = s * i;
            this.shadedRect(h, c, i, i, t.wall), this.ctx.fillStyle = t.wallTop, this.ctx.fillRect(h + 1, c + 1, i - 2, i * 0.3);
          }
        }
  }
  drawRoomLabels() {
    const { ctx: i, ts: t } = this, s = (O + 1) * t, e = this.world.gridWidth * t;
    this.env === "town" ? (i.fillStyle = "rgba(100, 80, 40, 0.3)", i.fillRect(t, s, e - 2 * t, Math.max(1, this.scale * 0.5))) : (i.fillStyle = "rgba(120, 180, 255, 0.15)", i.fillRect(t, s + t * 0.4, e - 2 * t, Math.max(1, this.scale * 0.8)), i.fillStyle = "rgba(200, 230, 255, 0.08)", i.fillRect(t, s + t * 0.1, e - 2 * t, Math.max(1, this.scale * 0.4)));
    for (const l of this.world.rooms) {
      if (this.env === "town" && l.id === 0 && l.name === "Town Square") continue;
      const n = (l.bounds.x + l.bounds.w / 2) * t, o = l.bounds.y * t - t * 0.1, a = Math.max(7, t * 0.45);
      if (i.font = `bold ${a}px sans-serif`, i.textAlign = "center", i.textBaseline = "middle", l.id === 9e3) {
        const r = Math.max(8, t * 0.45);
        i.font = `bold ${r}px sans-serif`;
        const h = t * 0.5;
        i.textBaseline = "middle", i.textAlign = "left", i.fillStyle = this.env === "town" ? "rgba(240, 232, 208, 0.8)" : "rgba(200, 220, 255, 0.75)", i.fillText("⬥ " + l.name, (l.bounds.x + 0.5) * t, h), i.textAlign = "center";
        continue;
      }
      if (this.env === "town") {
        const r = Math.max(8, t * 0.5);
        i.font = `bold ${r}px sans-serif`;
        const h = i.measureText(l.name).width, c = Math.max(h + t * 0.4, l.bounds.w * t * 0.8), d = t * 0.55, f = n - c / 2, u = (l.roofY ?? l.bounds.y) * t + (t - d) / 2;
        if (i.fillStyle = "rgba(40, 25, 10, 0.75)", i.fillRect(f, u, c, d), i.fillStyle = "rgba(80, 50, 20, 0.5)", i.fillRect(f, u, c, Math.max(1, this.scale * 0.3)), i.fillRect(f, u + d - Math.max(1, this.scale * 0.3), c, Math.max(1, this.scale * 0.3)), i.textBaseline = "middle", i.fillStyle = "#F0E8D0", i.fillText(l.name, n, u + d / 2), l.kanbanStageName && l.kanbanStageName !== l.name) {
          const b = Math.max(6, r * 0.6);
          i.font = `${b}px sans-serif`, i.fillStyle = "rgba(240, 232, 208, 0.55)", i.fillText(`→ ${l.kanbanStageName}`, n, u + d + b * 0.7);
        }
        i.font = `bold ${a}px sans-serif`;
      } else if (i.textBaseline = "bottom", i.fillStyle = "rgba(255,255,255,0.25)", i.fillText(l.name, n, o), l.kanbanStageName && l.kanbanStageName !== l.name) {
        const r = Math.max(5, a * 0.6);
        i.font = `${r}px sans-serif`, i.fillStyle = "rgba(255,255,255,0.15)", i.textBaseline = "top", i.fillText(`→ ${l.kanbanStageName}`, n, o + 2), i.font = `bold ${a}px sans-serif`;
      }
    }
  }
  /** Draw animated screen content (code, charts, ECG) */
  drawScreenContent(i, t, s, e, l, n) {
    const o = this.ctx, a = Date.now();
    let r = 0;
    for (let c = 0; c < l.length; c++) r = (r << 5) - r + l.charCodeAt(c) | 0;
    r = Math.abs(r);
    const h = n ? 3 : r % 3;
    if (o.save(), o.beginPath(), o.rect(i, t, s, e), o.clip(), h === 0) {
      const c = Math.max(2, Math.floor(e / 7)), d = a * 0.015 % (e * 2), f = ["#88CCFF", "#FFCC44", "#88FF88", "#FF8888", "#CCAAFF"];
      for (let g = 0; g < 8; g++) {
        const u = t - d + g * (c + Math.max(1, c * 0.4));
        if (u < t - c || u > t + e) continue;
        const b = s * (0.25 + (r + g * 7) % 5 / 8), A = (r + g * 3) % 3 * s * 0.1;
        o.fillStyle = f[(r + g) % f.length], o.globalAlpha = 0.5, o.fillRect(i + 2 + A, u, b, c - 1);
      }
    } else if (h === 1) {
      const d = (s - 4) / 4;
      for (let f = 0; f < 4; f++) {
        const g = e * (0.2 + (r + f * 13) % 6 / 10), u = Math.sin(a * 2e-3 + f * 1.5) * e * 0.04;
        o.fillStyle = f % 2 === 0 ? "#44AAFF" : "#44FF88", o.globalAlpha = 0.5, o.fillRect(i + 2 + f * d, t + e - g - u, d - 2, g + u);
      }
    } else if (h === 2) {
      o.globalAlpha = 0.4;
      const c = 3, d = 3, f = (s - 4) / d, g = (e - 4) / c;
      for (let u = 0; u < c; u++)
        for (let b = 0; b < d; b++)
          o.fillStyle = (u + b) % 2 === 0 ? "#88CCFF" : "#44FF88", o.fillRect(i + 2 + b * f, t + 2 + u * g, f - 1, g - 1);
    } else {
      o.strokeStyle = "#00FF88", o.lineWidth = 1, o.globalAlpha = 0.7, o.beginPath();
      const c = Math.max(1, Math.floor(s / 20));
      for (let d = 0; d < s; d += c) {
        const g = (a * 4e-3 + d * 0.15 + r) % (Math.PI * 8) % (Math.PI * 2), u = g < 0.6 ? Math.sin(g * 10) * e * 0.3 : 0, b = t + e / 2 - u;
        d === 0 ? o.moveTo(i + d, b) : o.lineTo(i + d, b);
      }
      o.stroke();
    }
    if (Math.floor(a / 500) % 2 === 0) {
      o.fillStyle = "#FFFFFF", o.globalAlpha = 0.7;
      const c = Math.max(2, e * 0.12);
      o.fillRect(i + s * 0.08, t + e - c - 2, Math.max(1, s * 0.04), c);
    }
    o.fillStyle = "rgba(0,0,0,0.05)", o.globalAlpha = 1;
    for (let c = 0; c < e; c += 2)
      o.fillRect(i, t + c, s, 1);
    o.restore();
  }
  /* ── glow effects ─────────────────────────────── */
  drawGlowEffects() {
    const { ctx: i, ts: t } = this, s = this.world;
    i.save(), i.globalCompositeOperation = "lighter";
    for (const e of s.zones) {
      if (!e.assignedAgentId || !G.DESK_ZONES.has(e.type)) continue;
      const l = e.position.x * t + t * 0.5, n = e.position.y * t, o = this.colors.screenOn, a = i.createRadialGradient(l, n, 0, l, n, t * 1.2);
      a.addColorStop(0, this.hexToRgba(o, 0.06)), a.addColorStop(1, this.hexToRgba(o, 0)), i.fillStyle = a, i.fillRect(l - t * 1.2, n - t * 1.2, t * 2.4, t * 2.4);
    }
    for (let e = 0; e < s.gridHeight; e++)
      for (let l = 0; l < s.gridWidth; l++) {
        const n = s.tiles[e][l].type, o = l * t + t * 0.5, a = e * t + t * 0.5;
        let r = null, h = t * 1.2, c = 0.05;
        switch (n) {
          case "rocket_engine":
            r = "#FF6600", h = t * 2, c = 0.1;
            break;
          case "hull_window":
            this.env === "space_station" && (r = "#4488FF", c = 0.03);
            break;
          case "xray_machine":
            r = "#00BCD4", c = 0.04;
            break;
          case "treasure_chest":
            r = "#FFD700", c = 0.04;
            break;
          case "lamppost":
            r = "#FFDD66", h = t * 2, c = 0.08;
            break;
          case "fountain":
            r = "#88CCFF", c = 0.04;
            break;
          case "hospital_bed":
            r = "#AADDFF", c = 0.03;
            break;
          case "sink":
            r = "#88BBDD", c = 0.02;
            break;
          case "tractor":
            r = "#FFCC44", h = t * 1.5, c = 0.05;
            break;
          case "cannon":
            r = "#FF8844", c = 0.03;
            break;
          case "ship_wheel":
            r = "#FFAA44", c = 0.04;
            break;
          case "satellite":
            r = "#66AAFF", h = t * 1.5, c = 0.04;
            break;
          case "solar_panel":
            r = "#44CCFF", c = 0.03;
            break;
          case "coffee":
            r = "#FF9944", c = 0.02;
            break;
        }
        if (r) {
          const d = i.createRadialGradient(o, a, 0, o, a, h);
          d.addColorStop(0, this.hexToRgba(r, c)), d.addColorStop(1, this.hexToRgba(r, 0)), i.fillStyle = d, i.fillRect(o - h, a - h, h * 2, h * 2);
        }
      }
    i.restore();
  }
  /* ── agent ──────────────────────────────────── */
  drawAgent(i) {
    const { ctx: t, ts: s, scale: e } = this;
    if (i.portalState !== "none") {
      const k = i.x * s + s / 2, S = i.y * s + s / 2;
      if (i.portalState === "departing") {
        const w = Math.min(1, i.portalTimer / 0.6), M = s * 0.5 + w * s * 0.6, p = 0.4 * (1 - w * 0.5), R = t.createRadialGradient(k, S, 0, k, S, M);
        R.addColorStop(0, `rgba(100,220,255,${p})`), R.addColorStop(0.6, `rgba(100,220,255,${p * 0.5})`), R.addColorStop(1, "rgba(100,220,255,0)"), t.fillStyle = R, t.fillRect(k - M, S - M, M * 2, M * 2);
        for (let C = 0; C < 6; C++) {
          const P = w * Math.PI * 4 + C * Math.PI / 3, T = M * (1 - w), B = k + Math.cos(P) * T, D = S + Math.sin(P) * T;
          t.fillStyle = `rgba(180,240,255,${0.6 * (1 - w)})`, t.beginPath(), t.arc(B, D, e * 0.8, 0, Math.PI * 2), t.fill();
        }
        if (w < 0.8) {
          const C = 1 - w * 1.2;
          if (C > 0) {
            const { frame: P, flip: T } = i.getCurrentSprite(), B = P.width * e * C, D = P.height * e * C, z = k - B / 2, L = S - D / 2;
            t.globalAlpha = 1 - w;
            const I = this.getEnvPalette(i);
            j(t, P, z, L, e * C, I, T), t.globalAlpha = 1;
          }
        }
        if (w > 0.7) {
          const C = (w - 0.7) / 0.3 * 0.4;
          t.fillStyle = `rgba(255,255,255,${C})`, t.beginPath(), t.arc(k, S, s * 0.8, 0, Math.PI * 2), t.fill();
        }
      } else if (i.portalState === "arriving") {
        const w = Math.min(1, i.portalTimer / 0.5), M = s * 1.2 * w, p = 0.35 * (1 - w);
        t.strokeStyle = `rgba(100,220,255,${p})`, t.lineWidth = Math.max(1, e * 0.6 * (1 - w)), t.beginPath(), t.arc(k, S, M, 0, Math.PI * 2), t.stroke();
        const R = Math.min(1, w * 1.5), { frame: C, flip: P } = i.getCurrentSprite(), T = C.width * e * R, B = C.height * e * R, D = k - T / 2, z = S - B / 2;
        t.globalAlpha = Math.min(1, w * 2);
        const L = this.getEnvPalette(i);
        j(t, C, D, z, e * R, L, P), t.globalAlpha = 1;
        for (let I = 0; I < 4; I++) {
          const F = w * Math.PI * 2 + I * Math.PI / 2, v = s * 0.3 + w * s * 0.5, E = k + Math.cos(F) * v, _ = S + Math.sin(F) * v;
          t.fillStyle = `rgba(180,240,255,${0.5 * (1 - w)})`, t.beginPath(), t.arc(E, _, e * 0.6 * (1 - w), 0, Math.PI * 2), t.fill();
        }
      }
      return;
    }
    const { frame: l, flip: n } = i.getCurrentSprite(), o = l.width * e, a = l.height * e, r = i.x * s + (s - o) / 2, h = i.isWalking ? Math.abs(Math.sin(i.animTimer * 8)) * e * 0.6 : 0, c = i.isAtDesk && !i.isWalking ? Math.sin(i.breathPhase) * e * 0.4 : 0, d = i.isAtDesk && !i.isWalking ? Math.min(1, (Date.now() - i._arriveTime || 0) / 200) : 1, f = d < 1 ? 1 + (1 - d) * 0.08 : 1, g = d < 1 ? 1 - (1 - d) * 0.08 : 1, u = i.y * s + (s - a) / 2 - e * 2 + c + h;
    t.fillStyle = "rgba(0,0,0,0.18)", t.beginPath(), t.ellipse(i.x * s + s / 2, i.y * s + s - e * 1.5, o * 0.25, e * 1.2, 0, 0, Math.PI * 2), t.fill();
    const b = et[i.resolvedActivity];
    b && i.resolvedActivity !== "idle" && (t.fillStyle = this.hexToRgba(b, 0.06), t.beginPath(), t.ellipse(i.x * s + s / 2, i.y * s + s - e * 1.5, o * 0.4, e * 2, 0, 0, Math.PI * 2), t.fill());
    const A = this.getEnvPalette(i), m = i.resolvedActivity === "idle" && !i.isWalking;
    if (m && (t.save(), t.globalAlpha = 0.45, t.filter = "grayscale(85%)"), f !== 1 || g !== 1 ? (t.save(), t.translate(r + o / 2, u + a), t.scale(f, g), t.translate(-(r + o / 2), -(u + a)), j(t, l, r, u, e, A, n), t.restore()) : j(t, l, r, u, e, A, n), i.isBlinking) {
      const S = u + 3 * e, w = n ? 6 : 3, M = n ? 3 : 6;
      t.fillStyle = A.skin, t.fillRect(r + w * e, S, e * 2, e), t.fillRect(r + M * e, S, e * 2, e);
    }
    if (this.drawHeadgear(i, r, u, o, a), i.isAtDesk && !i.isWalking) {
      const k = Kt[i.resolvedActivity];
      if (k) {
        const S = Math.sin(Date.now() * 3e-3) * e * 0.6, w = r + o + e, M = u + a * 0.4 + S;
        this.drawActivityProp(k, w, M, e);
      }
    }
    m && t.restore();
  }
  drawHeadgear(i, t, s, e, l) {
    const { ctx: n, scale: o } = this, a = t + e * 0.5, r = s + o * 2;
    switch (this.env) {
      case "space_station": {
        n.strokeStyle = "rgba(180,220,255,0.6)", n.lineWidth = Math.max(1, o * 0.6), n.beginPath(), n.arc(a, r, o * 3.5, 0, Math.PI * 2), n.stroke(), n.fillStyle = "rgba(180,220,255,0.12)", n.fill(), n.fillStyle = "rgba(255,255,255,0.25)", n.beginPath(), n.arc(a - o, r - o * 0.8, o * 1.2, 0, Math.PI * 2), n.fill();
        break;
      }
      case "rocket": {
        const h = s - o * 0.8;
        n.fillStyle = "#FFB800", n.fillRect(a - o * 3.2, h + o * 0.5, o * 6.4, o * 2), n.fillStyle = "#E5A600", n.fillRect(a - o * 2.8, h, o * 5.6, o * 1.5), n.fillStyle = "#CC9200", n.fillRect(a - o * 2.5, h + o * 0.6, o * 5, o * 0.4);
        break;
      }
      case "farm": {
        const h = s - o * 1.5;
        n.fillStyle = "#8B6914", n.fillRect(a - o * 4, h + o * 2.5, o * 8, o * 1.2), n.fillStyle = "#A07820", n.fillRect(a - o * 2.5, h, o * 5, o * 2.8), n.fillStyle = "#8B6914", n.fillRect(a - o * 2, h + o * 1, o * 4, o * 0.5);
        break;
      }
      case "hospital": {
        i.paletteIndex % 3 === 1 && (n.fillStyle = "#FFFFFF", n.fillRect(a - o * 2.5, s - o * 0.5, o * 5, o * 2), n.fillStyle = "#E74C3C", n.fillRect(a - o * 0.5, s, o * 1, o * 1));
        break;
      }
      case "pirate_ship": {
        const h = s - o * 1.2;
        i.paletteIndex % 3 === 0 ? (n.fillStyle = "#1A1A1A", n.fillRect(a - o * 3.5, h + o * 1.5, o * 7, o * 1.2), n.fillStyle = "#2A2A2A", n.fillRect(a - o * 2.5, h, o * 5, o * 2), n.fillStyle = "#FFCC00", n.fillRect(a - o * 2.5, h + o * 1.5, o * 5, o * 0.3)) : (n.fillStyle = "#CC2222", n.fillRect(a - o * 3, h + o * 0.8, o * 6, o * 1.5), n.fillStyle = "#AA1111", n.fillRect(a + o * 1.5, h + o * 1.2, o * 2.5, o * 0.8));
        break;
      }
      case "town": {
        if (i.paletteIndex % 3 === 0) {
          const h = s - o * 0.5;
          n.fillStyle = "#4A6A8A", n.fillRect(a - o * 2.8, h + o * 0.5, o * 5.6, o * 1.2), n.fillStyle = "#3A5A7A", n.fillRect(a - o * 1.5, h + o * 1.5, o * 5, o * 0.6);
        }
        break;
      }
    }
  }
  /* ── activity props ─────────────────────────── */
  drawActivityProp(i, t, s, e) {
    const l = this.ctx, n = e, o = n * 1.2;
    switch (i) {
      case "pencil": {
        l.fillStyle = "#FFD700", l.save(), l.translate(t, s), l.rotate(-0.4), l.fillRect(0, 0, o * 1, o * 4), l.fillStyle = "#333", l.fillRect(0, o * 3.5, o * 1, o * 0.8), l.fillStyle = "#FF8888", l.fillRect(0, -o * 0.3, o * 1, o * 0.5), l.restore();
        break;
      }
      case "hammer": {
        l.fillStyle = "#7A5A32", l.fillRect(t, s + o * 1.2, o * 0.8, o * 3), l.fillStyle = "#888", l.fillRect(t - o * 0.6, s + o * 0.3, o * 2, o * 1.2), l.fillStyle = "#AAA", l.fillRect(t - o * 0.4, s + o * 0.5, o * 1.6, o * 0.4);
        break;
      }
      case "clipboard": {
        l.fillStyle = "#8B6914", l.fillRect(t, s, o * 3, o * 4), l.fillStyle = "#FFF", l.fillRect(t + o * 0.3, s + o * 0.6, o * 2.4, o * 3.1), l.fillStyle = "#AAA", l.fillRect(t + o * 0.6, s + o * 1.2, o * 1.8, o * 0.3), l.fillRect(t + o * 0.6, s + o * 2, o * 1.4, o * 0.3), l.fillRect(t + o * 0.6, s + o * 2.8, o * 1.6, o * 0.3), l.fillStyle = "#888", l.fillRect(t + o * 1, s - o * 0.3, o * 1, o * 0.6);
        break;
      }
      case "magnifier": {
        l.strokeStyle = "#555", l.lineWidth = Math.max(1, n * 0.5), l.beginPath(), l.arc(t + o * 1.5, s + o * 1.5, o * 1.2, 0, Math.PI * 2), l.stroke(), l.fillStyle = "rgba(150,200,255,0.25)", l.fill(), l.fillStyle = "rgba(255,255,255,0.3)", l.beginPath(), l.arc(t + o * 1.2, s + o * 1.2, o * 0.4, 0, Math.PI * 2), l.fill(), l.strokeStyle = "#7A5A32", l.lineWidth = Math.max(1, n * 0.6), l.beginPath(), l.moveTo(t + o * 2.4, s + o * 2.4), l.lineTo(t + o * 3.5, s + o * 3.5), l.stroke();
        break;
      }
      case "book": {
        l.fillStyle = "#2980B9", l.fillRect(t, s + o * 0.3, o * 3, o * 3.5), l.fillStyle = "#F0F0E0", l.fillRect(t + o * 2.6, s + o * 0.6, o * 0.4, o * 2.9), l.fillStyle = this.darken("#2980B9", 0.15), l.fillRect(t, s + o * 0.3, o * 0.3, o * 3.5), l.fillStyle = "#FFD700", l.fillRect(t + o * 0.6, s + o * 1.5, o * 1.5, o * 0.3);
        break;
      }
      case "flask": {
        l.fillStyle = "#D5F5E3", l.beginPath(), l.moveTo(t + o * 0.8, s + o * 1), l.lineTo(t, s + o * 4), l.lineTo(t + o * 3, s + o * 4), l.lineTo(t + o * 2.2, s + o * 1), l.closePath(), l.fill(), l.strokeStyle = "#1ABC9C", l.lineWidth = 1, l.stroke(), l.fillStyle = "#D5F5E3", l.fillRect(t + o * 1, s, o * 1, o * 1.2), l.fillStyle = "rgba(26,188,156,0.4)", l.fillRect(t + o * 0.3, s + o * 2.5, o * 2.4, o * 1.3), l.fillStyle = "rgba(26,188,156,0.6)", this.circle(t + o * 1.2, s + o * 2.8, o * 0.2), this.circle(t + o * 1.8, s + o * 3.2, o * 0.15);
        break;
      }
      case "wrench": {
        l.fillStyle = "#888", l.save(), l.translate(t + o * 0.5, s), l.rotate(0.3), l.fillRect(0, o * 1, o * 0.8, o * 2.5), l.fillRect(-o * 0.3, o * 0.2, o * 1.4, o * 0.8), l.fillStyle = this.colors.floor, l.fillRect(o * 0.1, o * 0.4, o * 0.6, o * 0.6), l.restore();
        break;
      }
      case "checkmark": {
        l.strokeStyle = "#27AE60", l.lineWidth = Math.max(2, n * 0.6), l.beginPath(), l.moveTo(t, s + o * 2), l.lineTo(t + o * 1.2, s + o * 3.5), l.lineTo(t + o * 3.5, s + o * 0.5), l.stroke();
        break;
      }
      case "warning": {
        l.fillStyle = "#F1C40F", l.beginPath(), l.moveTo(t + o * 1.5, s), l.lineTo(t, s + o * 3.5), l.lineTo(t + o * 3, s + o * 3.5), l.closePath(), l.fill(), l.strokeStyle = "#E67E22", l.lineWidth = 1, l.stroke(), l.fillStyle = "#333", l.fillRect(t + o * 1.3, s + o * 1, o * 0.4, o * 1.4), l.fillRect(t + o * 1.3, s + o * 2.7, o * 0.4, o * 0.4);
        break;
      }
      case "hourglass": {
        l.fillStyle = "#8B6914", l.fillRect(t, s, o * 3, o * 0.4), l.fillRect(t, s + o * 3.6, o * 3, o * 0.4), l.fillStyle = "#F5DEB3", l.beginPath(), l.moveTo(t + o * 0.3, s + o * 0.4), l.lineTo(t + o * 2.7, s + o * 0.4), l.lineTo(t + o * 1.5, s + o * 2), l.closePath(), l.fill(), l.beginPath(), l.moveTo(t + o * 1.5, s + o * 2), l.lineTo(t + o * 0.3, s + o * 3.6), l.lineTo(t + o * 2.7, s + o * 3.6), l.closePath(), l.fill();
        const a = 0.5 + Math.sin(Date.now() * 5e-3) * 0.3;
        l.fillStyle = `rgba(210,180,140,${a.toFixed(2)})`, l.fillRect(t + o * 1.35, s + o * 1.8, o * 0.3, o * 0.5);
        break;
      }
    }
  }
  /* ── speech bubble ──────────────────────────── */
  /** Truncate message to short status label (1-2 words max) */
  truncateMessage(i) {
    if (i.length <= 16) return i;
    const t = i.lastIndexOf(" ", 16);
    return (t > 6 ? i.slice(0, t) : i.slice(0, 14)) + "...";
  }
  drawBubble(i) {
    if (!i.message) return;
    const { ctx: t, ts: s, scale: e } = this, l = i.x * s + s / 2, n = i.y * s - s * 0.4, o = this.truncateMessage(i.message);
    t.font = `${Math.max(10, e * 3)}px monospace`;
    const a = t.measureText(o).width, r = 6, h = a + r * 2, c = e * 4 + r * 2, d = l - h / 2, f = n - c, g = 4;
    t.fillStyle = "#F5E6C8", t.strokeStyle = "#8B6914", t.lineWidth = 2, t.beginPath(), t.moveTo(d + g, f), t.lineTo(d + h - g, f), t.quadraticCurveTo(d + h, f, d + h, f + g), t.lineTo(d + h, f + c - g), t.quadraticCurveTo(d + h, f + c, d + h - g, f + c), t.lineTo(l + 4, f + c), t.lineTo(l, f + c + 5), t.lineTo(l - 4, f + c), t.lineTo(d + g, f + c), t.quadraticCurveTo(d, f + c, d, f + c - g), t.lineTo(d, f + g), t.quadraticCurveTo(d, f, d + g, f), t.closePath(), t.fill(), t.stroke(), t.strokeStyle = "#E8D5B0", t.lineWidth = 1, t.strokeRect(d + 2, f + 2, h - 4, c - 4), t.fillStyle = "#3A2A1A", t.textAlign = "center", t.textBaseline = "middle", t.fillText(o, l, f + c / 2);
  }
  /* ── conversation lines ───────────────────────── */
  drawConversationLines(i) {
    const { ctx: t, ts: s } = this, e = /* @__PURE__ */ new Set();
    for (const l of i) {
      if (l.socialAction !== "chatting" || !l.socialPartnerId) continue;
      const n = [l.id, l.socialPartnerId].sort().join(":");
      if (e.has(n)) continue;
      e.add(n);
      const o = i.find((m) => m.id === l.socialPartnerId);
      if (!o) continue;
      const a = l.x * s + s / 2, r = l.y * s + s * 0.3, h = o.x * s + s / 2, c = o.y * s + s * 0.3, d = (a + h) / 2, f = (r + c) / 2 - s * 0.6;
      t.save(), t.setLineDash([3, 4]), t.strokeStyle = "rgba(255,200,100,0.35)", t.lineWidth = Math.max(1, this.scale * 0.4), t.beginPath(), t.moveTo(a, r), t.quadraticCurveTo(d, f, h, c), t.stroke(), t.setLineDash([]), t.restore();
      const u = 0.3 + (Math.sin(Date.now() * 5e-3) + 1) / 2 * 0.4, b = (1 - u) * (1 - u) * a + 2 * (1 - u) * u * d + u * u * h, A = (1 - u) * (1 - u) * r + 2 * (1 - u) * u * f + u * u * c;
      t.fillStyle = "rgba(255,220,130,0.5)", t.beginPath(), t.arc(b, A, Math.max(1.5, this.scale * 0.6), 0, Math.PI * 2), t.fill();
    }
  }
  /* ── name label ─────────────────────────────── */
  drawNameLabel(i) {
    const { ctx: t, ts: s, scale: e } = this, l = i.x * s + s / 2, n = i.y * s + s + e;
    t.font = `bold ${Math.max(9, e * 2.5)}px sans-serif`;
    const o = t.measureText(i.name).width, a = e * 0.8, r = a * 2 + 4 + o, h = e * 3 + 4;
    if (t.fillStyle = "rgba(50,35,15,0.75)", this.roundRect(l - r / 2 - 3, n - h / 2, r + 6, h, 3), t.strokeStyle = "rgba(139,105,20,0.4)", t.lineWidth = 1, t.strokeRect(l - r / 2 - 2.5, n - h / 2 + 0.5, r + 5, h - 1), t.fillStyle = et[i.resolvedActivity] ?? "#95A5A6", t.beginPath(), t.arc(l - r / 2 + a, n, a, 0, Math.PI * 2), t.fill(), t.fillStyle = "#FFF", t.textAlign = "center", t.textBaseline = "middle", t.fillText(i.name, l + a + 2, n), i.activeTaskCount > 0) {
      const c = r + 2, d = Math.max(2, e * 0.6), f = l - c / 2, g = n + h / 2 + 1, u = i.completedTaskCount + i.activeTaskCount, b = u > 0 ? i.completedTaskCount / u : 0;
      t.fillStyle = "rgba(0,0,0,0.5)", t.fillRect(f, g, c, d), t.fillStyle = "#27AE60", t.fillRect(f, g, c * b, d);
    }
  }
  /* ── status icons ───────────────────────────── */
  drawStatusIcon(i) {
    if (i.message) return;
    const { ctx: t, ts: s, scale: e } = this, l = i.x * s + s / 2, n = Math.sin(Date.now() * 4e-3 + i.paletteIndex) * e * 0.6, o = i.y * s - s * 0.25 + n, a = e * 2, r = i.resolvedActivity, h = (c) => {
      t.fillStyle = c, t.beginPath(), t.arc(l, o, a * 0.55, 0, Math.PI * 2), t.fill(), t.strokeStyle = "rgba(0,0,0,0.2)", t.lineWidth = 1, t.beginPath(), t.arc(l, o, a * 0.55, 0, Math.PI * 2), t.stroke();
    };
    switch (r) {
      // Planning — animated thought bubble with dots
      case "planning":
      case "analyzing":
      case "decomposing": {
        t.fillStyle = "rgba(255,255,255,0.6)", t.beginPath(), t.arc(l + a * 0.3, o + a * 0.5, a * 0.12, 0, Math.PI * 2), t.fill(), t.beginPath(), t.arc(l + a * 0.15, o + a * 0.3, a * 0.18, 0, Math.PI * 2), t.fill(), t.fillStyle = "rgba(255,255,255,0.85)", t.beginPath(), t.arc(l, o - a * 0.1, a * 0.45, 0, Math.PI * 2), t.fill(), t.strokeStyle = "rgba(0,0,0,0.15)", t.lineWidth = 1, t.beginPath(), t.arc(l, o - a * 0.1, a * 0.45, 0, Math.PI * 2), t.stroke();
        const c = Math.floor(Date.now() / 400) % 3;
        for (let d = 0; d < 3; d++)
          t.fillStyle = d === c ? "#F39C12" : "#BDC3C7", t.beginPath(), t.arc(l + (d - 1) * a * 0.25, o - a * 0.1, a * 0.08, 0, Math.PI * 2), t.fill();
        break;
      }
      // Reading — open book icon
      case "reading": {
        h("rgba(155,89,182,0.15)"), t.fillStyle = "#9B59B6", t.fillRect(l - a * 0.25, o - a * 0.15, a * 0.22, a * 0.3), t.fillRect(l + a * 0.03, o - a * 0.15, a * 0.22, a * 0.3), t.fillStyle = "#7D3C98", t.fillRect(l - a * 0.03, o - a * 0.18, a * 0.06, a * 0.36);
        break;
      }
      // Searching — magnifying glass with pulse
      case "searching":
      case "grepping": {
        const c = 0.8 + Math.sin(Date.now() * 6e-3) * 0.2;
        t.strokeStyle = `rgba(142,68,173,${c})`, t.lineWidth = 2, t.beginPath(), t.arc(l - a * 0.08, o - a * 0.08, a * 0.22, 0, Math.PI * 2), t.stroke(), t.beginPath(), t.moveTo(l + a * 0.1, o + a * 0.1), t.lineTo(l + a * 0.3, o + a * 0.3), t.stroke();
        break;
      }
      // Coding — brackets <>
      case "coding":
      case "generating":
      case "refactoring": {
        h("rgba(52,152,219,0.12)"), t.strokeStyle = "#3498DB", t.lineWidth = 2, t.beginPath(), t.moveTo(l - a * 0.05, o - a * 0.2), t.lineTo(l - a * 0.25, o), t.lineTo(l - a * 0.05, o + a * 0.2), t.stroke(), t.beginPath(), t.moveTo(l + a * 0.05, o - a * 0.2), t.lineTo(l + a * 0.25, o), t.lineTo(l + a * 0.05, o + a * 0.2), t.stroke();
        break;
      }
      // Testing — flask with bubbling
      case "testing":
      case "validating": {
        t.strokeStyle = "#1ABC9C", t.lineWidth = 2, t.beginPath(), t.moveTo(l - a * 0.15, o - a * 0.3), t.lineTo(l + a * 0.15, o - a * 0.3), t.moveTo(l - a * 0.1, o - a * 0.3), t.lineTo(l - a * 0.25, o + a * 0.25), t.lineTo(l + a * 0.25, o + a * 0.25), t.lineTo(l + a * 0.1, o - a * 0.3), t.stroke();
        const c = Math.floor(Date.now() / 300) % 3;
        t.fillStyle = "#1ABC9C", t.beginPath(), t.arc(l - a * 0.08, o + a * (0.05 - c * 0.08), a * 0.04, 0, Math.PI * 2), t.fill(), t.beginPath(), t.arc(l + a * 0.06, o + a * (0.12 - (c + 1) % 3 * 0.06), a * 0.03, 0, Math.PI * 2), t.fill();
        break;
      }
      // Linting — checkmark in box
      case "linting": {
        t.strokeStyle = "#16A085", t.lineWidth = 2, t.strokeRect(l - a * 0.3, o - a * 0.3, a * 0.6, a * 0.6), t.beginPath(), t.moveTo(l - a * 0.15, o), t.lineTo(l - a * 0.05, o + a * 0.15), t.lineTo(l + a * 0.2, o - a * 0.15), t.stroke();
        break;
      }
      // Committing/pushing — arrow up with glow
      case "committing":
      case "pushing": {
        h("rgba(108,92,231,0.1)"), t.strokeStyle = "#6C5CE7", t.lineWidth = 2, t.beginPath(), t.moveTo(l, o + a * 0.25), t.lineTo(l, o - a * 0.15), t.moveTo(l - a * 0.18, o + a * 0.02), t.lineTo(l, o - a * 0.25), t.lineTo(l + a * 0.18, o + a * 0.02), t.stroke();
        break;
      }
      // Deploying — rocket with animated flame
      case "deploying": {
        const c = Math.sin(Date.now() * 0.01) * a * 0.08;
        t.fillStyle = "#4834D4", t.beginPath(), t.moveTo(l, o - a * 0.35), t.lineTo(l - a * 0.15, o + a * 0.1), t.lineTo(l + a * 0.15, o + a * 0.1), t.closePath(), t.fill(), t.fillStyle = "#FF6600", t.beginPath(), t.moveTo(l - a * 0.08, o + a * 0.1), t.lineTo(l, o + a * 0.3 + c), t.lineTo(l + a * 0.08, o + a * 0.1), t.closePath(), t.fill(), t.fillStyle = "#FFCC00", t.beginPath(), t.moveTo(l - a * 0.04, o + a * 0.1), t.lineTo(l, o + a * 0.22 + c * 0.5), t.lineTo(l + a * 0.04, o + a * 0.1), t.closePath(), t.fill();
        break;
      }
      // Paused — ZZZ sleep
      case "paused": {
        const c = Date.now() * 1e-3;
        t.font = `bold ${a * 0.6}px sans-serif`, t.textAlign = "center", t.textBaseline = "middle";
        for (let d = 0; d < 3; d++) {
          const f = 0.3 + (2 - d) * 0.2;
          t.fillStyle = `rgba(189,195,199,${f})`, t.fillText("z", l + d * a * 0.2 + Math.sin(c + d) * 2, o - d * a * 0.25);
        }
        break;
      }
      // Blocked — pulsing red lock
      case "blocked": {
        const c = 0.6 + Math.sin(Date.now() * 5e-3) * 0.3;
        h(`rgba(192,57,43,${(c * 0.15).toFixed(2)})`), t.strokeStyle = `rgba(192,57,43,${c})`, t.lineWidth = 2, t.beginPath(), t.arc(l, o - a * 0.15, a * 0.15, Math.PI, 0), t.stroke(), t.fillStyle = `rgba(192,57,43,${c})`, t.fillRect(l - a * 0.2, o, a * 0.4, a * 0.3), t.fillStyle = "#FFF", t.beginPath(), t.arc(l, o + a * 0.08, a * 0.04, 0, Math.PI * 2), t.fill(), t.fillRect(l - 1, o + a * 0.1, 2, a * 0.1);
        break;
      }
      // Success — animated green sparkle checkmark
      case "success": {
        const c = 0.6 + Math.sin(Date.now() * 6e-3) * 0.4;
        h(`rgba(39,174,96,${(c * 0.15).toFixed(2)})`), t.strokeStyle = "#27AE60", t.lineWidth = 2, t.beginPath(), t.moveTo(l - a * 0.25, o), t.lineTo(l - a * 0.05, o + a * 0.2), t.lineTo(l + a * 0.25, o - a * 0.2), t.stroke(), c > 0.8 && (t.fillStyle = "#2ECC71", t.beginPath(), t.arc(l + a * 0.35, o - a * 0.3, a * 0.06, 0, Math.PI * 2), t.fill(), t.beginPath(), t.arc(l - a * 0.3, o - a * 0.2, a * 0.04, 0, Math.PI * 2), t.fill());
        break;
      }
      // Error — pulsing red X
      case "error": {
        const c = 0.5 + Math.sin(Date.now() * 8e-3) * 0.4;
        h(`rgba(231,76,60,${(c * 0.2).toFixed(2)})`), t.strokeStyle = `rgba(231,76,60,${c})`, t.lineWidth = 2, t.beginPath(), t.moveTo(l - a * 0.2, o - a * 0.2), t.lineTo(l + a * 0.2, o + a * 0.2), t.moveTo(l + a * 0.2, o - a * 0.2), t.lineTo(l - a * 0.2, o + a * 0.2), t.stroke();
        break;
      }
      // Waiting approval — RPG quest exclamation mark
      case "waiting_approval": {
        const c = Math.abs(Math.sin(Date.now() * 4e-3)) * a * 0.15;
        t.fillStyle = "#E67E22", t.beginPath(), t.arc(l, o - c, a * 0.5, 0, Math.PI * 2), t.fill(), t.strokeStyle = "#D35400", t.lineWidth = 1, t.beginPath(), t.arc(l, o - c, a * 0.5, 0, Math.PI * 2), t.stroke(), t.fillStyle = "#FFF", t.font = `bold ${a}px sans-serif`, t.textAlign = "center", t.textBaseline = "middle", t.fillText("!", l, o - c);
        break;
      }
      // Reviewing — eye icon
      case "reviewing": {
        t.strokeStyle = "#E67E22", t.lineWidth = 2, t.beginPath(), t.moveTo(l - a * 0.3, o), t.quadraticCurveTo(l, o - a * 0.25, l + a * 0.3, o), t.quadraticCurveTo(l, o + a * 0.25, l - a * 0.3, o), t.stroke(), t.fillStyle = "#E67E22", t.beginPath(), t.arc(l, o, a * 0.08, 0, Math.PI * 2), t.fill();
        break;
      }
    }
  }
  /* ── town lighting ─────────────────────────── */
  /** Environment-aware atmosphere lighting overlay with per-tile point lights */
  drawLightingOverlay() {
    if (this.env === "rocket" || this.env === "space_station") return;
    const { ctx: i, ts: t } = this, s = this.world, e = s.gridWidth * t, l = s.gridHeight * t, o = {
      town: "rgb(245, 235, 215)",
      // warm golden
      office: "rgb(240, 240, 245)",
      // cool fluorescent
      farm: "rgb(245, 240, 210)",
      // warm sunset
      hospital: "rgb(235, 245, 250)",
      // sterile blue-white
      pirate_ship: "rgb(220, 225, 240)"
      // moonlit
    }[this.env];
    if (!o) return;
    (!this.lightCanvas || this.lightCanvas.width !== e || this.lightCanvas.height !== l) && (this.lightCanvas = document.createElement("canvas"), this.lightCanvas.width = e, this.lightCanvas.height = l);
    const a = this.lightCanvas.getContext("2d");
    a.clearRect(0, 0, e, l), a.fillStyle = o, a.fillRect(0, 0, e, l), a.globalCompositeOperation = "lighter";
    for (let r = 0; r < s.gridHeight; r++)
      for (let h = 0; h < s.gridWidth; h++) {
        const c = s.tiles[r][h].type, d = h * t + t / 2, f = r * t + t / 2;
        let g = null, u = t * 2, b = 0.4, A = 0;
        if (c === "lamppost") {
          g = "rgba(60, 50, 20, 0.7)", u = t * 3.5, A = -t * 0.3;
          const m = a.createRadialGradient(d, f + A, 0, d, f + A, u);
          m.addColorStop(0, "rgba(60, 50, 20, 0.7)"), m.addColorStop(0.5, "rgba(40, 35, 15, 0.2)"), m.addColorStop(1, "rgba(0, 0, 0, 0)"), a.fillStyle = m, a.fillRect(d - u, f + A - u, u * 2, u * 2);
          continue;
        } else c === "building_window" ? (g = "rgba(50, 40, 15, ALPHA)", u = t * 2, b = 0.4) : c === "fountain" ? (g = "rgba(15, 30, 50, ALPHA)", u = t * 1.5, b = 0.25) : c === "xray_machine" ? (g = "rgba(0, 188, 212, ALPHA)", u = t * 1.5, b = 0.2) : c === "hospital_bed" ? (g = "rgba(50, 50, 40, ALPHA)", u = t * 1.2, b = 0.15) : c === "tractor" ? (g = "rgba(60, 50, 15, ALPHA)", u = t * 1.5, b = 0.2) : c === "treasure_chest" ? (g = "rgba(60, 50, 0, ALPHA)", u = t * 1.5, b = 0.3) : c === "ship_wheel" ? (g = "rgba(50, 40, 10, ALPHA)", u = t * 1.2, b = 0.15) : c === "coffee" && (g = "rgba(50, 35, 10, ALPHA)", u = t * 1, b = 0.15);
        if (g) {
          const m = a.createRadialGradient(d, f + A, 0, d, f + A, u);
          m.addColorStop(0, g.replace("ALPHA", b.toFixed(2))), m.addColorStop(1, "rgba(0, 0, 0, 0)"), a.fillStyle = m, a.fillRect(d - u, f + A - u, u * 2, u * 2);
        }
      }
    a.globalCompositeOperation = "source-over", i.save(), i.globalCompositeOperation = "multiply", i.drawImage(this.lightCanvas, 0, 0), i.restore();
  }
  /* ── helpers ────────────────────────────────── */
  circle(i, t, s) {
    this.ctx.beginPath(), this.ctx.arc(i, t, s, 0, Math.PI * 2), this.ctx.fill();
  }
  roundRect(i, t, s, e, l) {
    const n = this.ctx;
    n.beginPath(), n.moveTo(i + l, t), n.lineTo(i + s - l, t), n.quadraticCurveTo(i + s, t, i + s, t + l), n.lineTo(i + s, t + e - l), n.quadraticCurveTo(i + s, t + e, i + s - l, t + e), n.lineTo(i + l, t + e), n.quadraticCurveTo(i, t + e, i, t + e - l), n.lineTo(i, t + l), n.quadraticCurveTo(i, t, i + l, t), n.closePath(), n.fill();
  }
  darken(i, t) {
    const s = `d:${i}:${t}`, e = this.colorCache.get(s);
    if (e) return e;
    const l = parseInt(i.slice(1, 3), 16), n = parseInt(i.slice(3, 5), 16), o = parseInt(i.slice(5, 7), 16), a = "#" + [l, n, o].map((r) => Math.round(r * (1 - t)).toString(16).padStart(2, "0")).join("");
    return this.colorCache.set(s, a), a;
  }
  lighten(i, t) {
    const s = `l:${i}:${t}`, e = this.colorCache.get(s);
    if (e) return e;
    const l = parseInt(i.slice(1, 3), 16), n = parseInt(i.slice(3, 5), 16), o = parseInt(i.slice(5, 7), 16), a = "#" + [l, n, o].map((r) => Math.min(255, Math.round(r + (255 - r) * t)).toString(16).padStart(2, "0")).join("");
    return this.colorCache.set(s, a), a;
  }
  hexToRgba(i, t) {
    const s = parseInt(i.slice(1, 3), 16), e = parseInt(i.slice(3, 5), 16), l = parseInt(i.slice(5, 7), 16);
    return `rgba(${s},${e},${l},${t})`;
  }
  /** Draw a rectangle with outline, highlight (top/left), and shadow (bottom/right) edges */
  shadedRect(i, t, s, e, l, n) {
    const o = this.ctx, a = { outline: !0, highlight: !0, shadow: !0, highlightAmt: 0.2, shadowAmt: 0.2, ...n }, r = Math.max(1, Math.floor(this.scale * 0.4));
    a.outline ? (o.fillStyle = this.darken(l, 0.35), o.fillRect(i, t, s, e), o.fillStyle = l, o.fillRect(i + 1, t + 1, s - 2, e - 2)) : (o.fillStyle = l, o.fillRect(i, t, s, e));
    const h = a.outline ? 1 : 0;
    a.highlight && s > 4 && e > 4 && (o.fillStyle = this.lighten(l, a.highlightAmt), o.fillRect(i + h, t + h, s - h * 2, r), o.fillRect(i + h, t + h, r, e - h * 2)), a.shadow && s > 4 && e > 4 && (o.fillStyle = this.darken(l, a.shadowAmt), o.fillRect(i + h, t + e - h - r, s - h * 2, r), o.fillRect(i + s - h - r, t + h, r, e - h * 2));
  }
  /** Draw a circle with outline and highlight spot */
  shadedCircle(i, t, s, e, l = !0) {
    const n = this.ctx;
    l && s > 2 && (n.fillStyle = this.darken(e, 0.3), n.beginPath(), n.arc(i, t, s + 1, 0, Math.PI * 2), n.fill()), n.fillStyle = e, n.beginPath(), n.arc(i, t, s, 0, Math.PI * 2), n.fill(), s > 3 && (n.fillStyle = this.lighten(e, 0.25), n.beginPath(), n.arc(i - s * 0.2, t - s * 0.25, s * 0.4, 0, Math.PI * 2), n.fill());
  }
  /* ── Task visualization ──────────────────────── */
  getPriorityColor(i) {
    switch (i) {
      case "critical":
        return "#E74C3C";
      case "high":
        return "#F39C12";
      case "medium":
        return "#3498DB";
      case "low":
        return "#95A5A6";
      default:
        return "#95A5A6";
    }
  }
  drawTaskItems(i) {
    const { ctx: t, ts: s } = this;
    for (const e of i.items) {
      const l = e.gridX * s, n = e.gridY * s;
      if (e.isBeingWorked) {
        const a = 0.15 + Math.sin(Date.now() * 5e-3) * 0.1, r = this.getPriorityColor(e.priority);
        t.save(), t.fillStyle = this.hexToRgba(r, a), t.beginPath(), t.ellipse(l + s / 2, n + s / 2, s * 0.55, s * 0.45, 0, 0, Math.PI * 2), t.fill(), t.restore();
      }
      if (e.stage === "done") {
        t.save(), t.globalAlpha = 0.45, this.drawEnvironmentTaskItem(l, n, e), t.restore();
        const a = Math.max(4, s * 0.25), r = l + s * 0.75, h = n + s * 0.25;
        t.save(), t.strokeStyle = "#27AE60", t.lineWidth = Math.max(1.5, s * 0.08), t.lineCap = "round", t.lineJoin = "round", t.beginPath(), t.moveTo(r - a * 0.4, h), t.lineTo(r, h + a * 0.4), t.lineTo(r + a * 0.5, h - a * 0.35), t.stroke(), t.restore();
        continue;
      }
      const o = e.isBeingWorked ? Math.sin(Date.now() * 6e-3) * this.scale * 0.5 : 0;
      this.drawEnvironmentTaskItem(l, n + o, e);
    }
    if (i.overflows)
      for (const e of i.overflows)
        this.drawOverflowBadge(e);
    if (i.completionBag && this.drawCompletionAccumulator(i.completionBag), i.stageCounts)
      for (const e of i.stageCounts)
        this.drawRoomTaskCount(e);
  }
  drawOverflowBadge(i) {
    const { ctx: t, ts: s } = this, e = i.gridX * s + s / 2, l = i.gridY * s + s / 2, n = Math.max(8, s * 0.6);
    t.save(), t.font = `bold ${n}px sans-serif`, t.textAlign = "center", t.textBaseline = "middle", t.fillStyle = "rgba(0, 0, 0, 0.45)", t.fillText("+", e, l), t.restore();
  }
  drawRoomTaskCount(i) {
    if (i.count === 0) return;
    const { ctx: t, ts: s } = this, e = i.count > 99 ? "99+" : `${i.count}`, l = (i.bounds.x + i.bounds.w / 2) * s, o = (i.bounds.y + Math.floor(i.bounds.h / 2)) * s, a = Math.max(24, s * 2);
    t.save(), t.font = `bold ${a}px sans-serif`, t.textAlign = "center", t.textBaseline = "middle", t.fillStyle = "rgba(0, 0, 0, 0.18)", t.fillText(e, l, o), t.restore();
  }
  drawEnvironmentTaskItem(i, t, s) {
    switch (this.env) {
      case "office":
        this.drawOfficeTaskItem(i, t, s);
        break;
      case "town":
        this.drawTownTaskItem(i, t, s);
        break;
      case "rocket":
        this.drawRocketTaskItem(i, t, s);
        break;
      case "space_station":
        this.drawSpaceTaskItem(i, t, s);
        break;
      case "farm":
        this.drawFarmTaskItem(i, t, s);
        break;
      case "hospital":
        this.drawHospitalTaskItem(i, t, s);
        break;
      case "pirate_ship":
        this.drawPirateTaskItem(i, t, s);
        break;
      default:
        this.drawOfficeTaskItem(i, t, s);
        break;
    }
  }
  // ── Office: paper/folder with colored tab ──
  drawOfficeTaskItem(i, t, s) {
    const { ctx: e, ts: l } = this, n = this.getPriorityColor(s.priority);
    this.shadedRect(i + l * 0.2, t + l * 0.3, l * 0.6, l * 0.5, "#F5F5F0"), e.fillStyle = n, e.fillRect(i + l * 0.2, t + l * 0.26, l * 0.22, l * 0.08), e.fillStyle = "#CCC", e.fillRect(i + l * 0.28, t + l * 0.45, l * 0.42, l * 0.03), e.fillRect(i + l * 0.28, t + l * 0.54, l * 0.32, l * 0.03), e.fillRect(i + l * 0.28, t + l * 0.63, l * 0.36, l * 0.03);
  }
  // ── Town: parchment scroll with wax seal ──
  drawTownTaskItem(i, t, s) {
    const { ctx: e, ts: l } = this, n = this.getPriorityColor(s.priority);
    this.shadedRect(i + l * 0.2, t + l * 0.32, l * 0.6, l * 0.45, "#E8D5B0"), this.shadedCircle(i + l * 0.23, t + l * 0.34, l * 0.05, "#D4C090"), this.shadedCircle(i + l * 0.77, t + l * 0.34, l * 0.05, "#D4C090"), this.shadedCircle(i + l * 0.5, t + l * 0.68, l * 0.07, n), e.fillStyle = "#C4B08A", e.fillRect(i + l * 0.3, t + l * 0.45, l * 0.35, l * 0.02), e.fillRect(i + l * 0.3, t + l * 0.52, l * 0.28, l * 0.02);
  }
  // ── Rocket: circuit board with LED ──
  drawRocketTaskItem(i, t, s) {
    const { ctx: e, ts: l } = this, n = this.getPriorityColor(s.priority);
    this.shadedRect(i + l * 0.2, t + l * 0.35, l * 0.6, l * 0.4, "#1A3A2A"), e.fillStyle = "#44AA44", e.fillRect(i + l * 0.28, t + l * 0.45, l * 0.18, l * 0.025), e.fillRect(i + l * 0.52, t + l * 0.55, l * 0.2, l * 0.025), e.fillRect(i + l * 0.35, t + l * 0.6, l * 0.12, l * 0.025), e.fillStyle = "#2A2A2A", e.fillRect(i + l * 0.4, t + l * 0.42, l * 0.12, l * 0.08), e.fillStyle = n, e.beginPath(), e.arc(i + l * 0.72, t + l * 0.42, l * 0.035, 0, Math.PI * 2), e.fill();
  }
  // ── Space Station: data pad / tablet ──
  drawSpaceTaskItem(i, t, s) {
    const { ctx: e, ts: l } = this, n = this.getPriorityColor(s.priority);
    this.shadedRect(i + l * 0.22, t + l * 0.3, l * 0.56, l * 0.48, "#3A4A5A"), e.fillStyle = "#1A3050", e.fillRect(i + l * 0.27, t + l * 0.35, l * 0.46, l * 0.32), e.fillStyle = "#4488AA", e.fillRect(i + l * 0.32, t + l * 0.42, l * 0.3, l * 0.02), e.fillRect(i + l * 0.32, t + l * 0.48, l * 0.22, l * 0.02), e.fillStyle = n, e.beginPath(), e.arc(i + l * 0.5, t + l * 0.73, l * 0.03, 0, Math.PI * 2), e.fill();
  }
  // ── Farm: burlap seed bag ──
  drawFarmTaskItem(i, t, s) {
    const { ctx: e, ts: l } = this, n = this.getPriorityColor(s.priority);
    this.shadedRect(i + l * 0.25, t + l * 0.38, l * 0.5, l * 0.42, "#8B7355"), e.fillStyle = "#6B5335", e.fillRect(i + l * 0.35, t + l * 0.32, l * 0.3, l * 0.08), this.shadedCircle(i + l * 0.5, t + l * 0.33, l * 0.06, "#6B5335"), e.fillStyle = n, e.fillRect(i + l * 0.32, t + l * 0.52, l * 0.14, l * 0.1), e.strokeStyle = "#5A4235", e.lineWidth = Math.max(1, this.scale * 0.3), e.setLineDash([2, 2]), e.beginPath(), e.moveTo(i + l * 0.3, t + l * 0.68), e.lineTo(i + l * 0.7, t + l * 0.68), e.stroke(), e.setLineDash([]);
  }
  // ── Hospital: medical chart ──
  drawHospitalTaskItem(i, t, s) {
    const { ctx: e, ts: l } = this, n = this.getPriorityColor(s.priority);
    this.shadedRect(i + l * 0.22, t + l * 0.28, l * 0.52, l * 0.52, "#EEEEEE"), e.fillStyle = "#888", e.fillRect(i + l * 0.4, t + l * 0.25, l * 0.16, l * 0.06), e.fillStyle = "#E74C3C", e.fillRect(i + l * 0.4, t + l * 0.38, l * 0.16, l * 0.04), e.fillRect(i + l * 0.45, t + l * 0.34, l * 0.06, l * 0.12), e.fillStyle = n, e.fillRect(i + l * 0.27, t + l * 0.7, l * 0.42, l * 0.04), e.fillStyle = "#CCC", e.fillRect(i + l * 0.28, t + l * 0.55, l * 0.35, l * 0.025), e.fillRect(i + l * 0.28, t + l * 0.62, l * 0.28, l * 0.025);
  }
  // ── Pirate Ship: treasure map ──
  drawPirateTaskItem(i, t, s) {
    const { ctx: e, ts: l } = this, n = this.getPriorityColor(s.priority);
    this.shadedRect(i + l * 0.18, t + l * 0.3, l * 0.64, l * 0.48, "#D4C5A0"), e.fillStyle = "#B8A880", e.fillRect(i + l * 0.18, t + l * 0.3, l * 0.04, l * 0.48), e.fillRect(i + l * 0.78, t + l * 0.3, l * 0.04, l * 0.48), e.strokeStyle = "#8B6914", e.lineWidth = Math.max(1, this.scale * 0.4), e.beginPath(), e.moveTo(i + l * 0.28, t + l * 0.42), e.lineTo(i + l * 0.48, t + l * 0.55), e.lineTo(i + l * 0.68, t + l * 0.45), e.stroke(), e.strokeStyle = n, e.lineWidth = Math.max(1, this.scale * 0.5), e.beginPath(), e.moveTo(i + l * 0.55, t + l * 0.58), e.lineTo(i + l * 0.65, t + l * 0.68), e.moveTo(i + l * 0.65, t + l * 0.58), e.lineTo(i + l * 0.55, t + l * 0.68), e.stroke();
  }
  /* ── Completion accumulator (grows with completed tasks) ── */
  drawCompletionAccumulator(i) {
    const { ctx: t, ts: s } = this, e = Math.min(5, Math.floor(i.count / 3)), l = (i.roomX + i.roomW / 2) * s, n = (i.gridY + 1) * s, o = s / 16, a = Math.max(s * 2, (i.roomH - 1) * s);
    switch (t.save(), this.env) {
      case "office":
        this.drawPixelOffice(l, n, o, e, a);
        break;
      case "town":
        this.drawPixelTown(l, n, o, e, a);
        break;
      case "rocket":
        this.drawPixelRocket(l, n, o, e, a);
        break;
      case "space_station":
        this.drawPixelSpaceStation(l, n, o, e, a);
        break;
      case "farm":
        this.drawPixelFarm(l, n, o, e, a);
        break;
      case "hospital":
        this.drawPixelHospital(l, n, o, e, a);
        break;
      case "pirate_ship":
        this.drawPixelPirate(l, n, o, e, a);
        break;
      default:
        this.drawPixelOffice(l, n, o, e, a);
        break;
    }
    t.restore();
  }
  /** Helper: draw a pixel block (blocky rectangle) */
  pixelBlock(i, t, s, e, l) {
    this.ctx.fillStyle = l, this.ctx.fillRect(Math.round(i), Math.round(t), Math.round(s), Math.round(e));
  }
  /** Office: Dartboard — single iconic object, grows upward, clamped to room */
  drawPixelOffice(i, t, s, e, l) {
    const n = this.ctx, o = Math.min((l - s * 8) / 2, s * (8 + e * 3)), a = i, r = t - o - s * 4, h = o * 2 + s * 6;
    this.pixelBlock(i - h / 2, r - o - s * 3, h, o * 2 + s * 6, "#5C3D1A"), this.pixelBlock(i - h / 2 + s, r - o - s * 2, h - s * 2, o * 2 + s * 4, "#6B4226"), this.drawPixelCircle(a, r, o, "#1A1A1A"), this.drawPixelCircle(a, r, o - s * 2, "#1B7A2B"), this.drawPixelCircle(a, r, o - s * 4, "#CC2222"), o > s * 8 && this.drawPixelCircle(a, r, o - s * 6, "#E8DFC8"), o > s * 10 && this.drawPixelCircle(a, r, o - s * 8, "#1B7A2B"), o > s * 12 && this.drawPixelCircle(a, r, o - s * 10, "#CC2222"), this.drawPixelCircle(a, r, Math.max(s * 3, o * 0.18), "#1B7A2B"), this.drawPixelCircle(a, r, Math.max(s * 2, o * 0.1), "#CC2222"), n.strokeStyle = "#AAA", n.lineWidth = Math.max(1, s * 0.5), n.beginPath(), n.moveTo(a, r - o), n.lineTo(a, r + o), n.moveTo(a - o, r), n.lineTo(a + o, r), n.stroke();
    const c = [];
    c.push([a + s, r - s, "#3498DB", -0.3]), e >= 1 && c.push([a + o * 0.5, r - o * 0.3, "#E74C3C", 0.4]), e >= 2 && c.push([a - o * 0.4, r + o * 0.2, "#27AE60", -0.5]), e >= 3 && c.push([a + o * 0.2, r + o * 0.5, "#F39C12", 0.2]), e >= 4 && c.push([a - o * 0.6, r - o * 0.4, "#9B59B6", -0.6]), e >= 5 && c.push([a - s * 2, r + s, "#FF1493", 0.1]);
    for (const [d, f, g, u] of c)
      n.save(), n.translate(d, f), n.rotate(u), this.pixelBlock(-s / 2, -s * 3, s, s * 3, "#CCC"), this.pixelBlock(-s, -s * 6, s * 2, s * 3, g), this.pixelBlock(-s * 2, -s * 8, s * 4, s * 2, g), this.pixelBlock(-s, -s * 9, s * 2, s, g), n.restore();
    this.pixelBlock(i - s * 2, t - s * 4, s * 4, s * 4, "#5C3D1A"), this.pixelBlock(i - s * 4, t - s, s * 8, s, "#444");
  }
  /** Helper: draw a filled pixel circle at (cx,cy) with given radius */
  drawPixelCircle(i, t, s, e) {
    const l = this.ctx;
    l.fillStyle = e, l.beginPath(), l.arc(i, t, Math.max(1, s), 0, Math.PI * 2), l.fill();
  }
  /** Town: Pixel-art ceremonial key of the city (horizontal) */
  drawPixelTown(i, t, s, e, l) {
    const n = Math.min(l - s * 2, s * (28 + e * 12)), o = t - s * 8, a = s * 4, r = i - n / 2 + s * 8, h = n - s * 10;
    this.pixelBlock(r, o - a / 2, h, a, "#DAA520"), this.pixelBlock(r, o - a / 2, h, s, "#F0D060"), this.pixelBlock(r, o + a / 2 - s, h, s, "#B8860B");
    const c = s * 8, d = s * 10, f = r - c + s * 2, g = o - d / 2;
    this.pixelBlock(f + s * 2, g, c - s * 4, d, "#DAA520"), this.pixelBlock(f + s, g + s, s, d - s * 2, "#DAA520"), this.pixelBlock(f + c - s * 2, g + s, s, d - s * 2, "#DAA520"), this.pixelBlock(f, g + s * 2, s, d - s * 4, "#F0D060"), this.pixelBlock(f + c - s, g + s * 2, s, d - s * 4, "#B8860B"), this.pixelBlock(f + s * 2, o - s * 2, s * 4, s * 4, "#2C1810"), this.pixelBlock(f + s * 3, o - s, s * 2, s * 2, "#1A0F08");
    const u = Math.min(4, 1 + e), b = r + h - s * 4;
    for (let A = 0; A < u; A++) {
      const m = b - A * s * 5;
      this.pixelBlock(m, o + a / 2, s * 2, s * 4, "#DAA520"), this.pixelBlock(m - s * 2, o + a / 2 + s * 2, s * 2, s * 2, "#DAA520"), this.pixelBlock(m, o + a / 2, s, s * 4, "#F0D060");
    }
    if (e >= 2) {
      const A = r + h * 0.5;
      this.pixelBlock(A, o - a / 2 - s * 2, s, s * 2, "#DAA520"), this.pixelBlock(A, o + a / 2, s, s * 2, "#DAA520");
    }
    e >= 3 && (this.pixelBlock(f + s * 2, o - s, s * 2, s * 2, "#E74C3C"), this.pixelBlock(f + s * 2, o, s, s, "#FF6B6B")), e >= 4 && (this.pixelBlock(f + s * 3, g + d - s, s * 6, s * 2, "#3498DB"), this.pixelBlock(f + s * 3, g - s, s * 6, s * 2, "#E74C3C"));
  }
  /** Rocket: Tall sectioned rocket matching reference — red cone, white body, blue windows, red stripes, big fins, growing flames */
  drawPixelRocket(i, t, s, e, l) {
    const n = this.ctx, o = Math.min(l - s * 4, s * (28 + e * 18)), a = s * 12, r = i - a / 2;
    this.pixelBlock(i - s * 12, t - s * 3, s * 24, s * 3, "#555"), this.pixelBlock(i - s * 11, t - s * 2, s * 22, s, "#666"), e >= 2 && (this.pixelBlock(i - s * 8, t - s * 8, s * 3, s * 5, "#27AE60"), this.pixelBlock(i - s * 8, t - s * 9, s * 3, s, "#2ECC71"), this.pixelBlock(i - s * 7, t - s * 6, s, s * 2, "#FFF"), this.pixelBlock(i + s * 5, t - s * 8, s * 3, s * 5, "#27AE60"), this.pixelBlock(i + s * 5, t - s * 9, s * 3, s, "#2ECC71"), this.pixelBlock(i + s * 6, t - s * 6, s, s * 2, "#FFF")), this.pixelBlock(i - s * 9, t - s * 5, s * 2, s * 2, "#777"), this.pixelBlock(i + s * 7, t - s * 5, s * 2, s * 2, "#777");
    const h = t - s * 5, c = h - o;
    this.pixelBlock(r, c, a, o, "#E8E8E8"), this.pixelBlock(r, c, s, o, "#F4F4F4"), this.pixelBlock(r + a - s, c, s, o, "#CCCCCC");
    const d = Math.max(s * 8, o / Math.max(2, 1 + e)), f = Math.max(1, Math.floor(o / d));
    for (let p = 0; p < f; p++) {
      const R = h - (p + 1) * d;
      if (R < c) break;
      this.pixelBlock(r, R, a, s * 2, "#E74C3C");
      const C = R + d * 0.35;
      C + s * 5 < h && C > c + s * 2 && (this.pixelBlock(i - s * 3, C, s * 6, s * 5, "#2C3E50"), this.pixelBlock(i - s * 2, C + s, s * 4, s * 3, "#5DADE2"), this.pixelBlock(i - s * 2, C + s, s * 2, s, "#85C1E9"));
    }
    const g = c, u = Math.min(s * 8 + e * s * 2, o * 0.2), b = Math.max(3, Math.floor(u / s));
    for (let p = 0; p < b; p++) {
      const R = a - p * s * 2 * (a / (b * s * 2)), C = Math.max(s, Math.round(R));
      this.pixelBlock(i - C / 2, g - (p + 1) * s, C, s, "#E74C3C");
    }
    this.pixelBlock(i - s, g - b * s - s, s * 2, s, "#C0392B");
    const A = s * (8 + e * 3), m = s * (5 + e);
    this.pixelBlock(r - m, h - A, m, A, "#C0392B"), this.pixelBlock(r - m - s, h - A * 0.6, s, A * 0.6, "#C0392B"), this.pixelBlock(r + a, h - A, m, A, "#C0392B"), this.pixelBlock(r + a + m, h - A * 0.6, s, A * 0.6, "#C0392B");
    const k = Date.now() * 8e-3, S = s * (4 + e * 8), w = Math.sin(k) * s * 2, M = Math.cos(k * 1.3) * s;
    if (this.pixelBlock(i - s * 5, t - s * 3, s * 10, Math.min(S * 0.6, s * 20) + Math.abs(w), "#FF4400"), this.pixelBlock(i - s * 3, t - s * 2, s * 6, Math.min(S * 0.8, s * 24) + Math.abs(M), "#FF8800"), this.pixelBlock(i - s * 2, t - s, s * 4, Math.min(S * 0.5, s * 16) + Math.abs(w), "#FFCC00"), e >= 2 && this.pixelBlock(i - s, t, s * 2, Math.min(S * 0.3, s * 10) + Math.abs(M), "#FFFF88"), e >= 3 && (this.pixelBlock(r - m / 2, t - s * 2, s * 2, S * 0.2 + Math.abs(M), "#FF6600"), this.pixelBlock(r + a + m / 2 - s, t - s * 2, s * 2, S * 0.2 + Math.abs(w), "#FF6600")), e >= 4) {
      const p = 0.1 + Math.sin(k * 0.5) * 0.05;
      n.fillStyle = `rgba(180,180,180,${p})`, n.fillRect(i - s * 6, t + s * 3, s * 4, s * 4), n.fillRect(i + s * 3, t + s * 4, s * 3, s * 3);
    }
  }
  /** Space station: module cluster stacking upward */
  drawPixelSpaceStation(i, t, s, e, l) {
    this.ctx;
    const n = Math.min(1 + e * 0.2, l / (s * 30)), o = s * Math.max(1, n), a = o * 10, r = o * 7;
    if (this.pixelBlock(i - a / 2, t - r, a, r, "#4A5A6A"), this.pixelBlock(i - a / 2 + o, t - r + o, a - o * 2, r - o * 2, "#5A6A7A"), this.pixelBlock(i - o * 2, t - r + o * 2, o * 4, o * 3, "#2C3E50"), this.pixelBlock(i - o, t - r + o * 3, o * 2, o, "#3498DB"), this.pixelBlock(i - o, t - o * 2, o * 2, o, "#27AE60"), e >= 1 && (this.pixelBlock(i - a / 2 - o * 5, t - o * 6, o * 5, o * 5, "#3A4A5A"), this.pixelBlock(i - a / 2 - o, t - o * 5, o, o * 3, "#666")), e >= 2 && (this.pixelBlock(i + a / 2, t - o * 6, o * 5, o * 5, "#3A4A5A"), this.pixelBlock(i + a / 2 - o, t - o * 5, o, o * 3, "#666")), e >= 3) {
      const h = Math.max(t - l + o * 2, t - r - o * 6);
      this.pixelBlock(i - o * 4, h, o * 8, o * 6, "#5A6A7A"), this.pixelBlock(i - o, t - r - o, o * 2, o, "#666"), this.pixelBlock(i - a / 2 - o * 8, h + o, o * 6, o * 3, "#2C3E80"), this.pixelBlock(i + a / 2 + o * 2, h + o, o * 6, o * 3, "#2C3E80");
    }
    if (e >= 4) {
      const h = Math.max(t - l + o, t - r - o * 14);
      this.pixelBlock(i - o, h, o * 2, o * 8, "#888"), this.pixelBlock(i - o * 4, h - o * 2, o * 8, o * 2, "#AAA");
      const c = Math.sin(Date.now() * 4e-3) > 0;
      this.pixelBlock(i, h - o * 3, o, o, c ? "#E74C3C" : "#660000");
    }
    e >= 5 && this.pixelBlock(i - o * 6, t, o * 12, o * 3, "#4A5A6A");
  }
  /** Farm: Pixel-art cow — well-defined blocky cow that grows bigger */
  drawPixelFarm(i, t, s, e, l) {
    const n = l / (s * 22), o = Math.min(1 + e * 0.35, n), a = s * Math.max(1, o), r = a * 10, h = a * 6, c = a * 4;
    this.pixelBlock(i - r / 2 - a * 2, t - a, r + a * 6, a, "#4A8C3F");
    const d = t - a - c, f = d - h, g = i - r / 2;
    this.pixelBlock(g + a, d, a * 2, c, "#F0EDE0"), this.pixelBlock(g + a, d + c - a, a * 2, a, "#3A2A1A"), this.pixelBlock(g + a * 3, d, a * 2, c, "#E8E5D8"), this.pixelBlock(g + a * 3, d + c - a, a * 2, a, "#3A2A1A"), this.pixelBlock(g + r - a * 5, d, a * 2, c, "#F0EDE0"), this.pixelBlock(g + r - a * 5, d + c - a, a * 2, a, "#3A2A1A"), this.pixelBlock(g + r - a * 3, d, a * 2, c, "#E8E5D8"), this.pixelBlock(g + r - a * 3, d + c - a, a * 2, a, "#3A2A1A"), this.pixelBlock(g, f, r, h, "#F5F2E8"), this.pixelBlock(g, f, r, a, "#E0DDD2"), this.pixelBlock(g, f + h - a, r, a, "#D8D5C8"), this.pixelBlock(g + a * 2, f + a * 2, a * 3, a * 2, "#2A2A2A"), this.pixelBlock(g + a * 6, f + a, a * 2, a * 3, "#2A2A2A"), e >= 2 && this.pixelBlock(g + a * 4, f + a * 4, a * 2, a, "#2A2A2A"), e >= 4 && this.pixelBlock(g + a * 8, f + a * 2, a, a * 2, "#2A2A2A"), this.pixelBlock(g + a * 5, d, a * 2, a, "#FFCCAA"), this.pixelBlock(g + r, f + a, a, a * 3, "#2A2A2A"), this.pixelBlock(g + r + a, f + a * 3, a, a * 2, "#2A2A2A");
    const u = a * 5, b = a * 4, A = g - u + a, m = f - a;
    this.pixelBlock(A, m, u, b, "#F5F2E8"), this.pixelBlock(A + a, m + a, a, a, "#111"), this.pixelBlock(A + a * 3, m + a, a, a, "#111"), this.pixelBlock(A + a, m + a * 2, a * 3, a * 2, "#EECCAA"), this.pixelBlock(A + a + a / 2, m + a * 3, a / 2 || s, a / 2 || s, "#6A4A2A"), this.pixelBlock(A + a * 3, m + a * 3, a / 2 || s, a / 2 || s, "#6A4A2A"), this.pixelBlock(A, m - a, a, a, "#F5F2E8"), this.pixelBlock(A + a * 4, m - a, a, a, "#F5F2E8"), e >= 1 && (this.pixelBlock(A - a, m - a, a, a, "#DAA520"), this.pixelBlock(A + u, m - a, a, a, "#DAA520")), e >= 3 && (this.pixelBlock(A - a, m - a * 2, a, a, "#DAA520"), this.pixelBlock(A + u, m - a * 2, a, a, "#DAA520")), e >= 2 && (this.pixelBlock(A + a * 2, m + b, a, a, "#888"), this.pixelBlock(A + a, m + b + a, a * 3, a * 2, "#DAA520")), e >= 5 && (this.pixelBlock(A + a, m - a * 3, a * 3, a, "#FFD700"), this.pixelBlock(A, m - a * 4, a, a, "#FFD700"), this.pixelBlock(A + a * 2, m - a * 4, a, a, "#FFD700"), this.pixelBlock(A + a * 4, m - a * 4, a, a, "#FFD700"), this.pixelBlock(A + a * 2, m - a * 3, a, a, "#E74C3C"));
  }
  /** Hospital: Balloons only — more balloons with level, clamped to room */
  drawPixelHospital(i, t, s, e, l) {
    const n = this.ctx, o = [
      [0, "#E74C3C", 0]
    ];
    e >= 1 && (o.push([-5, "#3498DB", 2]), o.push([5, "#27AE60", 1])), e >= 2 && (o.push([-9, "#F39C12", 3]), o.push([9, "#9B59B6", 4])), e >= 3 && (o.push([-3, "#FF69B4", 5]), o.push([3, "#00CED1", 6])), e >= 4 && (o.push([-7, "#FFD700", 7]), o.push([7, "#FF6347", 8]), o.push([0, "#FF1493", 9])), e >= 5 && (o.push([-11, "#7B68EE", 10]), o.push([11, "#00FA9A", 8]));
    const a = Date.now() * 2e-3, r = i, h = t - s * 3, c = t - l + s * 4;
    for (let d = 0; d < o.length; d++) {
      const [f, g, u] = o[d], b = Math.sin(a + d * 0.8) * s * 2, A = i + f * s, m = t - s * 12 - u * s * 3 + b, k = Math.max(c, m), S = s * 5, w = s * 6;
      this.pixelBlock(A - S / 2, k - w, S, w, g), this.pixelBlock(A - S / 2 + s, k - w - s, S - s * 2, s, g), this.pixelBlock(A - s, k, s * 2, s, g), this.pixelBlock(A - S / 2 + s, k - w + s, s * 2, s, "#FFFFFF44"), n.strokeStyle = "#AAA", n.lineWidth = Math.max(1, this.scale * 0.3), n.beginPath(), n.moveTo(A, k + s), n.quadraticCurveTo(A + (r - A) * 0.3, k + (h - k) * 0.5, r, h), n.stroke();
    }
  }
  /** Pirate: Treasure chest with gold and pirate flag on top */
  drawPixelPirate(i, t, s, e, l) {
    const n = Math.min(1 + e * 0.25, l / (s * 36)), o = s * Math.max(1, n), a = o * 14, r = i - a / 2, h = o * 7;
    this.pixelBlock(r, t - h, a, h, "#7A5A10"), this.pixelBlock(r + o, t - h + o, a - o * 2, h - o * 2, "#9A7420"), this.pixelBlock(r, t - h + o * 2, a, o, "#555"), this.pixelBlock(r, t - o * 2, a, o, "#555"), this.pixelBlock(r + o, t - h + o, o, o, "#999"), this.pixelBlock(r + a - o * 2, t - h + o, o, o, "#999"), this.pixelBlock(i - o, t - h / 2 - o, o * 2, o * 2, "#777"), this.pixelBlock(i, t - h / 2, o, o, "#444");
    const c = t - h - o * 3;
    this.pixelBlock(r, c, a, o * 3, "#9A7420"), this.pixelBlock(r + o, c + o, a - o * 2, o, "#AA8430"), this.pixelBlock(r, c + o * 2, a, o, "#555");
    const d = c;
    e >= 1 && (this.pixelBlock(r + o * 2, d - o * 2, a - o * 4, o * 2, "#FFD700"), this.pixelBlock(r + o * 3, d - o * 3, a - o * 6, o, "#FFED4A")), e >= 2 && (this.pixelBlock(r + o * 3, d - o * 5, a - o * 6, o * 2, "#FFD700"), this.pixelBlock(r + o * 3, d - o * 4, o * 2, o * 2, "#E74C3C")), e >= 3 && (this.pixelBlock(r + o * 4, d - o * 7, a - o * 8, o * 2, "#FFD700"), this.pixelBlock(r + a - o * 5, d - o * 6, o * 2, o * 2, "#2ECC71"), this.pixelBlock(r + o * 5, d - o * 6, o * 2, o, "#3498DB")), e >= 4 && (this.pixelBlock(r + o * 5, d - o * 9, a - o * 10, o * 2, "#FFED4A"), this.pixelBlock(i - o * 3, d - o * 10, o * 6, o * 2, "#FFD700"), this.pixelBlock(i - o * 3, d - o * 11, o * 2, o, "#FFD700"), this.pixelBlock(i - o, d - o * 12, o * 2, o * 2, "#FFD700"), this.pixelBlock(i + o, d - o * 11, o * 2, o, "#FFD700"), this.pixelBlock(i, d - o * 11, o, o, "#E74C3C"));
    const f = i, g = e >= 4 ? d - o * 12 : e >= 3 ? d - o * 7 : e >= 2 ? d - o * 5 : e >= 1 ? d - o * 3 : d, u = Math.max(t - l + o * 2, g - o * 10);
    this.pixelBlock(f - o / 2, u, o, g - u, "#8B6914"), this.pixelBlock(f + o, u, o * 6, o * 4, "#1A1A1A"), this.pixelBlock(f + o * 2, u + o, o * 3, o * 2, "#FFF"), this.pixelBlock(f + o * 2, u + o, o, o, "#1A1A1A"), this.pixelBlock(f + o * 4, u + o, o, o, "#1A1A1A"), this.pixelBlock(f + o, u + o * 3, o, o, "#FFF"), this.pixelBlock(f + o * 5, u + o * 3, o, o, "#FFF"), this.pixelBlock(f + o * 3, u + o * 3, o, o, "#FFF");
  }
  /* ── Agent → task connection lines ───────────── */
  drawAgentTaskConnections(i, t) {
    const { ctx: s, ts: e } = this;
    for (const l of i) {
      if (l.resolvedActivity === "idle" || !l.isAtDesk || l.isWalking) continue;
      const n = t.items.filter((g) => g.assigneeId === l.id && g.isBeingWorked);
      if (n.length === 0) continue;
      let o = n[0], a = 1 / 0;
      for (const g of n) {
        const u = Math.abs(g.gridX - l.gridX) + Math.abs(g.gridY - l.gridY);
        u < a && (a = u, o = g);
      }
      const r = l.x * e + e / 2, h = l.y * e + e * 0.5, c = o.gridX * e + e / 2, d = o.gridY * e + e / 2;
      s.save(), s.setLineDash([2, 3]);
      const f = this.getPriorityColor(o.priority);
      s.strokeStyle = this.hexToRgba(f, 0.3), s.lineWidth = Math.max(1, this.scale * 0.3), s.beginPath(), s.moveTo(r, h), s.lineTo(c, d), s.stroke(), s.setLineDash([]), s.restore();
    }
  }
  /* ── Flying task transition animation ──────── */
  drawFlyingTasks(i) {
    if (!i.flyingTasks || i.flyingTasks.length === 0) return;
    const { ctx: t, ts: s } = this;
    for (const e of i.flyingTasks) {
      const l = e.progress, n = e.fromGX * s + s / 2, o = e.fromGY * s + s / 2, a = e.toGX * s + s / 2, r = e.toGY * s + s / 2, h = (n + a) / 2, c = Math.min(o, r) - s * 4, d = l, f = 1 - d, g = f * f * n + 2 * f * d * h + d * d * a, u = f * f * o + 2 * f * d * c + d * d * r;
      for (let S = 3; S >= 1; S--) {
        const w = Math.max(0, l - S * 0.04), M = 1 - w, p = M * M * n + 2 * M * w * h + w * w * a, R = M * M * o + 2 * M * w * c + w * w * r;
        t.save(), t.globalAlpha = 0.15 - S * 0.04, t.translate(p, R), this.drawFlyingItemBody(e), t.restore();
      }
      t.save(), t.translate(g, u);
      const b = Math.sin(l * Math.PI * 14) * 0.3, A = s * 0.35, m = s * 0.2, k = this.getPriorityColor(e.priority);
      t.fillStyle = this.hexToRgba(k, 0.6), t.save(), t.translate(-s * 0.25, -s * 0.05), t.rotate(-0.4 + b), t.beginPath(), t.moveTo(0, 0), t.lineTo(-A, -m * 0.5), t.lineTo(-A * 0.7, m * 0.3), t.closePath(), t.fill(), t.restore(), t.save(), t.translate(s * 0.25, -s * 0.05), t.rotate(0.4 - b), t.beginPath(), t.moveTo(0, 0), t.lineTo(A, -m * 0.5), t.lineTo(A * 0.7, m * 0.3), t.closePath(), t.fill(), t.restore(), this.drawFlyingItemBody(e), t.restore();
    }
  }
  /** Draw a small version of the task item for flying animation (already translated) */
  drawFlyingItemBody(i) {
    const { ctx: t, ts: s } = this, e = s * 0.4, l = this.getPriorityColor(i.priority);
    switch (this.env) {
      case "town":
        this.shadedRect(-e / 2, -e / 2, e, e * 0.7, "#E8D5B0"), this.shadedCircle(-e / 2 + e * 0.1, -e / 2 + e * 0.1, e * 0.08, "#D4C090"), this.shadedCircle(e / 2 - e * 0.1, -e / 2 + e * 0.1, e * 0.08, "#D4C090"), this.shadedCircle(0, e * 0.1, e * 0.1, l);
        break;
      case "rocket":
        this.shadedRect(-e / 2, -e / 2, e, e * 0.65, "#1A3A2A"), t.fillStyle = l, t.beginPath(), t.arc(e * 0.2, -e * 0.15, e * 0.07, 0, Math.PI * 2), t.fill();
        break;
      case "pirate_ship":
        this.shadedRect(-e / 2, -e / 2, e, e * 0.7, "#D4C5A0"), t.strokeStyle = l, t.lineWidth = Math.max(1, this.scale * 0.3), t.beginPath(), t.moveTo(-e * 0.1, 0), t.lineTo(e * 0.15, e * 0.1), t.stroke();
        break;
      default:
        this.shadedRect(-e / 2, -e / 2, e, e * 0.7, "#F5F5F0"), t.fillStyle = l, t.fillRect(-e / 2, -e / 2 - e * 0.05, e * 0.3, e * 0.1);
        break;
    }
  }
};
G.DESK_ZONES = /* @__PURE__ */ new Set([
  "desk",
  "tool_bench",
  "control_panel",
  "bridge_console",
  "barn_workshop",
  "nav_table",
  "science_lab",
  "lab_bench",
  "reception",
  "patient_station",
  "shop_counter",
  "workshop_bench"
]);
let U = G;
class Jt {
  constructor() {
    this.running = !1, this.lastTime = 0, this.frameId = 0, this.onUpdate = null, this.onRender = null, this.loop = () => {
      var s, e;
      if (!this.running) return;
      const i = performance.now(), t = Math.min((i - this.lastTime) / 1e3, 0.1);
      this.lastTime = i, (s = this.onUpdate) == null || s.call(this, t), (e = this.onRender) == null || e.call(this), this.frameId = requestAnimationFrame(this.loop);
    };
  }
  start() {
    this.running || (this.running = !0, this.lastTime = performance.now(), this.loop());
  }
  stop() {
    this.running = !1, this.frameId && (cancelAnimationFrame(this.frameId), this.frameId = 0);
  }
}
const nt = [
  "Just five more minutes...",
  "Organizing my desk...",
  "Reading the wiki...",
  "Thinking about lunch...",
  "Waiting for inspiration...",
  "Is it Friday yet?",
  "Almost ready to start...",
  "Looking for snacks...",
  "Contemplating existence...",
  "Pretending to be busy...",
  "Where was that file?",
  "Browsing the docs...",
  "Doodling in my notebook...",
  "Sharpening my pencil...",
  "Checking the weather...",
  "Reviewing old emails...",
  "Refilling my coffee...",
  "Taking a mental break...",
  "Reading patch notes...",
  "Stretching my legs..."
], H = class H {
  constructor(i) {
    this.agents = /* @__PURE__ */ new Map(), this.events = /* @__PURE__ */ new Map(), this.tileSize = 16, this.resizeObserver = null, this.activityLog = [], this.taskMap = /* @__PURE__ */ new Map(), this.reviewMap = /* @__PURE__ */ new Map(), this.objectiveMap = /* @__PURE__ */ new Map(), this.storyMap = /* @__PURE__ */ new Map(), this.sprintMap = /* @__PURE__ */ new Map(), this.milestoneMap = /* @__PURE__ */ new Map(), this.nextEvtId = 0, this.taskVizCache = null, this.taskVizDirty = !0, this.flyingTasks = [], this.settings = {
      particleDensity: "medium",
      animationSpeed: 1
    }, this.workspaces = /* @__PURE__ */ new Map(), this.activeWorkspaceId = null, this.onClick = (t) => {
      var a;
      const s = this.canvas.getBoundingClientRect(), e = window.devicePixelRatio || 1, l = (t.clientX - s.left) * e, n = (t.clientY - s.top) * e, o = this.renderer.getAgentAt(l, n, [...this.agents.values()]);
      o && ((a = this.onAgentClickCb) == null || a.call(this, o.id), this.emit("agentClick", o.id));
    }, this.container = i.container, this.scale = i.scale ?? 3, this.onAgentClickCb = i.onAgentClick ?? null, this.currentTheme = i.theme ?? "hybrid", this.currentSize = i.officeSize ?? "small", this.currentEnv = i.environment ?? "office", this.autoSizeEnabled = i.autoSize ?? !1, this.stageConfigs = i.stages ? [...i.stages] : [...ht], this.currentRoomMode = i.roomMode ?? "environment", Q(), this.canvas = document.createElement("canvas"), this.canvas.style.display = "block", this.canvas.style.width = "100%", this.canvas.style.height = "100%", this.canvas.style.imageRendering = "pixelated", this.container.appendChild(this.canvas), this.world = new qt(this.currentSize, this.currentTheme, this.currentEnv, this.currentRoomMode, this.stageConfigs), this.renderer = new U(
      this.canvas,
      this.world,
      this.scale,
      this.tileSize,
      this.currentTheme,
      this.currentEnv
    ), this.syncSize(), this.resizeObserver = new ResizeObserver(() => this.syncSize()), this.resizeObserver.observe(this.container), this.engine = new Jt(), this.engine.onUpdate = (t) => this.update(t), this.engine.onRender = () => this.render(), this.canvas.addEventListener("click", this.onClick), this.engine.start(), this.emit("ready");
  }
  /* ── theme, size & environment ──────────────── */
  get theme() {
    return this.currentTheme;
  }
  get officeSize() {
    return this.currentSize;
  }
  get environment() {
    return this.currentEnv;
  }
  setTheme(i) {
    this.currentTheme = i, this.renderer.setTheme(i), this.world.rebuild(this.currentSize, i, this.currentEnv, this.currentRoomMode, this.stageConfigs), this.reassignAgents(), this.syncSize(), this.emit("themeChanged", i);
  }
  setOfficeSize(i) {
    i !== this.currentSize && (this.currentSize = i, this.world.rebuild(i, this.currentTheme, this.currentEnv, this.currentRoomMode, this.stageConfigs), this.reassignAgents(), this.syncSize());
  }
  setEnvironment(i) {
    this.currentEnv = i, this.taskVizDirty = !0, this.renderer.setEnvironment(i, this.currentTheme), this.world.rebuild(this.currentSize, this.currentTheme, i, this.currentRoomMode, this.stageConfigs), this.reassignAgents(), this.syncSize();
  }
  /* ── stages & room mode (v0.3) ───────────────── */
  /** Get the current stage configurations */
  getStages() {
    return [...this.stageConfigs];
  }
  /** Set custom kanban stages. Rebuilds world layout. @since 0.3.0 */
  setStages(i) {
    this.stageConfigs = [...i], this.taskVizDirty = !0, this.world.rebuild(this.currentSize, this.currentTheme, this.currentEnv, this.currentRoomMode, this.stageConfigs), this.reassignAgents(), this.syncSize(), this.emit("stagesChanged", this.stageConfigs);
  }
  /** Get the current room layout mode */
  getRoomMode() {
    return this.currentRoomMode;
  }
  /** Toggle between 'environment' (standard rooms) and 'kanban' (stage-based rooms). @since 0.3.0 */
  setRoomMode(i) {
    i !== this.currentRoomMode && (this.currentRoomMode = i, this.taskVizDirty = !0, this.world.rebuild(this.currentSize, this.currentTheme, this.currentEnv, i, this.stageConfigs), this.reassignAgents(), this.syncSize(), this.emit("roomModeChanged", i));
  }
  /** Update visual/simulation settings */
  updateSettings(i) {
    Object.assign(this.settings, i);
  }
  getSettings() {
    return { ...this.settings };
  }
  /* ── workspaces ───────────────────────────────── */
  addWorkspace(i) {
    this.workspaces.set(i.id, i), this.emit("workspaceAdded", i);
  }
  removeWorkspace(i) {
    this.workspaces.delete(i), this.activeWorkspaceId === i && (this.activeWorkspaceId = null, this.applyWorkspaceFilter(), this.emit("workspaceChanged", null)), this.emit("workspaceRemoved", i);
  }
  updateWorkspace(i, t) {
    const s = this.workspaces.get(i);
    s && (Object.assign(s, t), this.activeWorkspaceId === i && this.applyWorkspaceFilter());
  }
  getWorkspaces() {
    return [...this.workspaces.values()];
  }
  getActiveWorkspaceId() {
    return this.activeWorkspaceId;
  }
  setActiveWorkspace(i) {
    this.activeWorkspaceId = i, this.applyWorkspaceFilter(), this.taskVizDirty = !0, this.emit("workspaceChanged", i);
  }
  applyWorkspaceFilter() {
    if (!this.activeWorkspaceId) {
      for (const s of this.agents.values()) s.visible = !0;
      return;
    }
    const i = this.workspaces.get(this.activeWorkspaceId);
    if (!i) return;
    const t = new Set(i.agentIds);
    for (const s of this.agents.values())
      s.visible = t.has(s.id);
  }
  reassignAgents() {
    Q();
    const i = [...this.agents.values()].map((t) => ({
      id: t.id,
      name: t.name,
      status: t.userStatus,
      message: t.message ?? void 0,
      role: t.role,
      team: t.team
    }));
    this.agents.clear();
    for (const t of i) this.addAgent(t);
  }
  /* ── agents ─────────────────────────────────── */
  addAgent(i) {
    if (this.agents.has(i.id)) throw new Error(`Agent "${i.id}" already exists`);
    const t = new V(i.id, i.name, this.world.spawnPoint, i.role, i.team);
    let s = null;
    if (this.isManagerRole(t) && (s = this.world.zones.find((e) => !e.assignedAgentId && e.roomId === H.ORCHESTRATOR_ROOM_ID) ?? null), s || (s = this.world.getAvailableZone()), s) {
      t.currentZoneId = s.id, t.currentZoneType = s.type, this.world.assignZone(s.id, i.id);
      const e = this.world.findPath(this.world.spawnPoint, s.position);
      e.length > 10 ? t.portalTo(s.position) : e.length > 1 ? t.walkTo(e) : this.teleport(t, s.position);
    }
    i.status && t.setStatus(i.status, i.message), i.skills && (t.skills = i.skills), this.agents.set(i.id, t), this.logActivity(i.id, "system", `${i.name} joined the office`), this.emit("agentAdded", i.id), this.autoSizeEnabled && this.autoResize();
  }
  /**
   * Updates an agent's status, message, name, or hierarchy context.
   * Status changes trigger activity logging, particle effects, and room movement.
   *
   * @param id - Agent ID
   * @param update - Fields to update (all optional)
   * @since 0.1.0
   */
  updateAgent(i, t) {
    const s = this.agents.get(i);
    if (!s) throw new Error(`Agent "${i}" not found`);
    if (t.name !== void 0 && (s.name = t.name), t.currentObjectiveId !== void 0 && (s.currentObjectiveId = t.currentObjectiveId), t.currentStoryId !== void 0 && (s.currentStoryId = t.currentStoryId), t.status !== void 0) {
      const e = s.resolvedActivity;
      s.setStatus(t.status, t.message), e !== s.resolvedActivity && (this.logActivity(
        i,
        "status_change",
        `${s.name} → ${t.status}${t.message ? ": " + t.message : ""}`
      ), s.resolvedActivity === "success" ? this.spawnEventParticles(s, "task_completed") : s.resolvedActivity === "error" ? this.spawnEventParticles(s, "error_burst") : s.resolvedActivity === "waiting_approval" ? this.spawnEventParticles(s, "review_submitted") : e === "idle" && s.resolvedActivity !== "idle" && this.spawnEventParticles(s, "task_picked"), this.scheduleMovement(s));
    } else t.message !== void 0 && (s.message = t.message, s.messageTimer = t.message ? 6 : 0, t.message && this.logActivity(i, "message", `${s.name}: ${t.message}`));
    this.emit("agentUpdated", i);
  }
  removeAgent(i) {
    const t = this.agents.get(i);
    t && (this.logActivity(i, "system", `${t.name} left the office`), this.world.freeZone(i), this.agents.delete(i), this.emit("agentRemoved", i), this.autoSizeEnabled && this.autoResize());
  }
  removeAllAgents() {
    for (const i of [...this.agents.keys()]) this.removeAgent(i);
  }
  getAgent(i) {
    return this.agents.get(i);
  }
  getAgents() {
    return [...this.agents.values()];
  }
  /** Check if an agent has a manager/leadership role */
  isManagerRole(i) {
    return i.role ? H.MANAGER_ROLES.test(i.role) : !1;
  }
  getPreferredZoneTypes(i) {
    return [];
  }
  getPhaseRoom(i) {
    if (this.isManagerRole(i))
      return H.ORCHESTRATOR_ROOM_ID;
    const t = H.ACTIVITY_STAGE[i.resolvedActivity];
    if (!t) return null;
    const s = this.stageConfigs.findIndex((e) => e.id === t);
    return s < 0 ? null : this.currentEnv === "town" ? s + 1 : s;
  }
  scheduleMovement(i) {
    if (i.isWalking) return;
    const t = this.getPreferredZoneTypes(i), s = this.getPhaseRoom(i), e = i.currentZoneId !== null ? this.world.zones.find((r) => r.id === i.currentZoneId) : null, l = (e == null ? void 0 : e.roomId) ?? -1;
    let n = s !== null ? this.world.zones.find(
      (r) => !r.assignedAgentId && r.roomId === s && t.includes(r.type)
    ) : void 0;
    if (n || (n = this.world.zones.find(
      (r) => !r.assignedAgentId && r.id !== i.currentZoneId && t.includes(r.type)
    )), !n && s !== null && (n = this.world.zones.find(
      (r) => !r.assignedAgentId && r.roomId === s
    )), n || (n = this.world.zones.find(
      (r) => !r.assignedAgentId && r.roomId !== l
    )), n || (n = this.world.zones.find(
      (r) => !r.assignedAgentId && r.id !== i.currentZoneId
    )), !n) return;
    i.currentZoneId !== null && this.world.freeZone(i.id), i.currentZoneId = n.id, i.currentZoneType = n.type, this.world.assignZone(n.id, i.id);
    const o = { x: Math.round(i.gridX), y: Math.round(i.gridY) }, a = this.world.findPath(o, n.position);
    a.length > 10 ? (i.isAtDesk = !1, i.isRoaming = !0, i.portalTo(n.position), this.spawnEventParticles(i, "task_picked")) : a.length > 1 ? (i.isAtDesk = !1, i.isRoaming = !0, i.walkTo(a)) : this.teleport(i, n.position), i.movementTimer = 8 + Math.random() * 7;
  }
  autoResize() {
    const i = this.container.getBoundingClientRect(), t = window.devicePixelRatio || 1, s = Nt(this.agents.size, i.width * t, i.height * t, this.tileSize);
    s !== this.currentSize && this.setOfficeSize(s);
  }
  /* ── activity log ───────────────────────────── */
  logActivity(i, t, s) {
    const e = this.agents.get(i), l = {
      id: `evt-${this.nextEvtId++}`,
      timestamp: Date.now(),
      agentId: i,
      agentName: (e == null ? void 0 : e.name) ?? i,
      type: t,
      description: s
    };
    this.activityLog.push(l), this.activityLog.length > 500 && this.activityLog.shift(), this.emit("activity", l);
  }
  getActivityLog() {
    return [...this.activityLog];
  }
  clearActivityLog() {
    this.activityLog = [];
  }
  /* ── tasks / kanban ─────────────────────────── */
  /**
   * Creates a new task. Tasks can optionally belong to a story via `storyId`.
   * Orphan tasks (no storyId) are fully supported for backward compatibility.
   *
   * @param task - Task data (createdAt/updatedAt are auto-set)
   * @since 0.1.0
   */
  addTask(i) {
    const t = { ...i, createdAt: Date.now(), updatedAt: Date.now() };
    this.taskMap.set(i.id, t), this.taskVizDirty = !0, this.logActivity(i.assigneeId ?? "system", "task_update", `Task created: ${i.title}`), this.emit("taskAdded", t), this.emit("taskUpdated", t), t.storyId && this.recomputeStoryProgress(t.storyId), t.assigneeId && this.recomputeAgentWorkload(t.assigneeId);
  }
  /**
   * Updates a task's fields. If stage changes, progress cascades upward
   * through story → objective → milestone automatically.
   *
   * @param id - Task ID
   * @param update - Partial fields to update
   * @since 0.1.0
   */
  updateTask(i, t) {
    const s = this.taskMap.get(i);
    if (!s) return;
    const e = s.stage, l = s.assigneeId;
    Object.assign(s, t, { updatedAt: Date.now() }), this.taskVizDirty = !0, this.logActivity(
      s.assigneeId ?? "system",
      "task_update",
      `Task "${s.title}" → ${s.stage}`
    ), this.emit("taskUpdated", s), e !== s.stage && this.spawnFlyingTask(s, e), s.storyId && e !== s.stage && this.recomputeStoryProgress(s.storyId), l && l !== s.assigneeId && this.recomputeAgentWorkload(l), s.assigneeId && this.recomputeAgentWorkload(s.assigneeId);
  }
  /**
   * Removes a task by ID. Cascades progress recomputation if task had a storyId.
   * @param id - Task ID
   * @since 0.2.0
   */
  removeTask(i) {
    const t = this.taskMap.get(i);
    t && (this.taskMap.delete(i), this.taskVizDirty = !0, this.emit("taskRemoved", i), t.storyId && this.recomputeStoryProgress(t.storyId), t.assigneeId && this.recomputeAgentWorkload(t.assigneeId));
  }
  getTasks() {
    return [...this.taskMap.values()];
  }
  getTasksByStage(i) {
    return this.getTasks().filter((t) => t.stage === i);
  }
  /**
   * Returns all tasks belonging to a story.
   * @param storyId - Story ID
   * @since 0.2.0
   */
  getTasksByStory(i) {
    return this.getTasks().filter((t) => t.storyId === i);
  }
  clearTasks() {
    this.taskMap.clear(), this.taskVizDirty = !0;
  }
  /* ── objectives ──────────────────────────────── */
  /**
   * Creates a new objective. Progress is auto-computed from child stories.
   *
   * @param obj - Objective data (progress/createdAt/updatedAt are auto-set)
   * @since 0.2.0
   *
   * @example
   * ```ts
   * town.addObjective({
   *   id: 'obj-1',
   *   title: 'User Authentication',
   *   description: 'Complete auth flow with login, signup, and OAuth',
   *   status: 'active',
   *   priority: 'critical',
   *   sprintId: 'sprint-1',
   * });
   * ```
   */
  addObjective(i) {
    const t = { ...i, progress: 0, createdAt: Date.now(), updatedAt: Date.now() };
    this.objectiveMap.set(i.id, t), this.logActivity("system", "system", `Objective created: ${i.title}`), this.emit("objectiveAdded", t);
  }
  /**
   * Updates an objective's fields.
   * @param id - Objective ID
   * @param update - Partial fields to update
   * @since 0.2.0
   */
  updateObjective(i, t) {
    const s = this.objectiveMap.get(i);
    s && (Object.assign(s, t, { updatedAt: Date.now() }), this.emit("objectiveUpdated", s));
  }
  /** Removes an objective by ID. @since 0.2.0 */
  removeObjective(i) {
    this.objectiveMap.has(i) && (this.objectiveMap.delete(i), this.emit("objectiveRemoved", i));
  }
  getObjective(i) {
    return this.objectiveMap.get(i);
  }
  getObjectives() {
    return [...this.objectiveMap.values()];
  }
  /** Returns objectives filtered by status. @since 0.2.0 */
  getObjectivesByStatus(i) {
    return this.getObjectives().filter((t) => t.status === i);
  }
  clearObjectives() {
    this.objectiveMap.clear();
  }
  /* ── stories ─────────────────────────────────── */
  /**
   * Creates a new story under an objective. Progress is auto-computed from child tasks.
   *
   * @param story - Story data (progress/createdAt/updatedAt are auto-set)
   * @since 0.2.0
   *
   * @example
   * ```ts
   * town.addStory({
   *   id: 'st-1',
   *   objectiveId: 'obj-1',
   *   title: 'Login/Signup Flow',
   *   description: 'Design and implement login form with validation',
   *   status: 'ready',
   *   priority: 'high',
   *   points: 5,
   * });
   * ```
   */
  addStory(i) {
    const t = { ...i, progress: 0, createdAt: Date.now(), updatedAt: Date.now() };
    this.storyMap.set(i.id, t), this.logActivity("system", "system", `Story created: ${i.title}`), this.emit("storyAdded", t), this.recomputeObjectiveProgress(i.objectiveId);
  }
  /**
   * Updates a story's fields.
   * @param id - Story ID
   * @param update - Partial fields to update
   * @since 0.2.0
   */
  updateStory(i, t) {
    const s = this.storyMap.get(i);
    s && (Object.assign(s, t, { updatedAt: Date.now() }), this.emit("storyUpdated", s), this.recomputeObjectiveProgress(s.objectiveId));
  }
  /** Removes a story by ID. @since 0.2.0 */
  removeStory(i) {
    const t = this.storyMap.get(i);
    t && (this.storyMap.delete(i), this.emit("storyRemoved", i), this.recomputeObjectiveProgress(t.objectiveId));
  }
  getStory(i) {
    return this.storyMap.get(i);
  }
  getStories() {
    return [...this.storyMap.values()];
  }
  /** Returns all stories belonging to an objective. @since 0.2.0 */
  getStoriesByObjective(i) {
    return this.getStories().filter((t) => t.objectiveId === i);
  }
  /** Returns stories filtered by status. @since 0.2.0 */
  getStoriesByStatus(i) {
    return this.getStories().filter((t) => t.status === i);
  }
  clearStories() {
    this.storyMap.clear();
  }
  /* ── sprints ─────────────────────────────────── */
  /**
   * Creates a new sprint for time-boxed iteration grouping.
   *
   * @param sprint - Sprint data (createdAt is auto-set)
   * @since 0.2.0
   *
   * @example
   * ```ts
   * town.addSprint({
   *   id: 'sprint-1',
   *   name: 'Sprint 1 — MVP',
   *   goal: 'Ship authentication and dashboard',
   *   status: 'active',
   * });
   * ```
   */
  addSprint(i) {
    const t = { ...i, createdAt: Date.now() };
    this.sprintMap.set(i.id, t), this.logActivity("system", "system", `Sprint created: ${i.name}`), this.emit("sprintAdded", t);
  }
  /** Updates a sprint's fields. @since 0.2.0 */
  updateSprint(i, t) {
    const s = this.sprintMap.get(i);
    s && (Object.assign(s, t), this.emit("sprintUpdated", s));
  }
  /** Removes a sprint by ID. @since 0.2.0 */
  removeSprint(i) {
    this.sprintMap.delete(i);
  }
  getSprint(i) {
    return this.sprintMap.get(i);
  }
  getSprints() {
    return [...this.sprintMap.values()];
  }
  /** Returns the first sprint with status 'active'. @since 0.2.0 */
  getActiveSprint() {
    return this.getSprints().find((i) => i.status === "active");
  }
  clearSprints() {
    this.sprintMap.clear();
  }
  /* ── milestones ──────────────────────────────── */
  /**
   * Creates a new milestone linking objectives to a deliverable target.
   *
   * @param ms - Milestone data (progress is auto-computed from linked objectives)
   * @since 0.2.0
   */
  addMilestone(i) {
    const t = { ...i, progress: 0 };
    this.milestoneMap.set(i.id, t), this.recomputeMilestoneProgress(i.id);
  }
  /** Updates a milestone's fields. @since 0.2.0 */
  updateMilestone(i, t) {
    const s = this.milestoneMap.get(i);
    s && (Object.assign(s, t), this.recomputeMilestoneProgress(i), this.emit("milestoneUpdated", s));
  }
  /** Removes a milestone by ID. @since 0.2.0 */
  removeMilestone(i) {
    this.milestoneMap.delete(i);
  }
  getMilestone(i) {
    return this.milestoneMap.get(i);
  }
  getMilestones() {
    return [...this.milestoneMap.values()];
  }
  clearMilestones() {
    this.milestoneMap.clear();
  }
  /* ── aggregate queries ───────────────────────── */
  /**
   * Returns the full hierarchy tree for an objective: the objective itself,
   * its stories, and all tasks within each story.
   *
   * @param objectiveId - Objective ID
   * @since 0.2.0
   */
  getObjectiveTree(i) {
    const t = this.objectiveMap.get(i);
    if (!t) return;
    const s = this.getStoriesByObjective(i).map((e) => ({
      story: e,
      tasks: this.getTasksByStory(e.id)
    }));
    return { objective: t, stories: s };
  }
  /**
   * Returns burndown data for a sprint: total, completed, remaining tasks,
   * and overall progress percentage.
   *
   * @param sprintId - Sprint ID
   * @since 0.2.0
   */
  getSprintBurndown(i) {
    const t = this.getObjectives().filter((o) => o.sprintId === i), s = /* @__PURE__ */ new Set();
    for (const o of t)
      for (const a of this.getStoriesByObjective(o.id))
        s.add(a.id);
    const e = this.getTasks().filter((o) => o.storyId && s.has(o.storyId)), l = e.filter((o) => o.stage === "done").length, n = e.length;
    return {
      totalTasks: n,
      completedTasks: l,
      remainingTasks: n - l,
      progressPercent: n > 0 ? Math.round(l / n * 100) : 0
    };
  }
  /* ── progress computation (private) ──────────── */
  recomputeStoryProgress(i) {
    const t = this.storyMap.get(i);
    if (!t) return;
    const s = this.getTasksByStory(i);
    if (s.length === 0) {
      t.progress = 0;
      return;
    }
    const e = s.filter((l) => l.stage === "done").length;
    t.progress = e / s.length, t.updatedAt = Date.now(), this.emit("storyUpdated", t), this.emit("progressChanged", "story", i, t.progress), t.progress >= 1 && t.status !== "done" && (t.status = "done", this.logActivity("system", "system", `Story completed: ${t.title}`)), this.recomputeObjectiveProgress(t.objectiveId);
  }
  recomputeObjectiveProgress(i) {
    const t = this.objectiveMap.get(i);
    if (!t) return;
    const s = this.getStoriesByObjective(i);
    if (s.length === 0) {
      t.progress = 0;
      return;
    }
    if (s.some((l) => l.points !== void 0)) {
      const l = s.reduce((o, a) => o + (a.points ?? 1), 0), n = s.reduce((o, a) => o + a.progress * (a.points ?? 1), 0);
      t.progress = l > 0 ? n / l : 0;
    } else
      t.progress = s.reduce((l, n) => l + n.progress, 0) / s.length;
    t.updatedAt = Date.now(), this.emit("objectiveUpdated", t), this.emit("progressChanged", "objective", i, t.progress), t.progress >= 1 && t.status !== "completed" && (t.status = "completed", this.logActivity("system", "system", `Objective completed: ${t.title}`));
    for (const l of this.milestoneMap.values())
      l.objectiveIds.includes(i) && this.recomputeMilestoneProgress(l.id);
  }
  recomputeMilestoneProgress(i) {
    const t = this.milestoneMap.get(i);
    if (!t || t.objectiveIds.length === 0) return;
    let s = 0;
    for (const e of t.objectiveIds) {
      const l = this.objectiveMap.get(e);
      s += (l == null ? void 0 : l.progress) ?? 0;
    }
    t.progress = s / t.objectiveIds.length, this.emit("milestoneUpdated", t), this.emit("progressChanged", "milestone", i, t.progress);
  }
  recomputeAgentWorkload(i) {
    const t = this.agents.get(i);
    if (!t) return;
    const s = this.getTasks().filter((e) => e.assigneeId === i);
    t.activeTaskCount = s.filter((e) => e.stage !== "done" && e.stage !== "backlog").length, t.completedTaskCount = s.filter((e) => e.stage === "done").length;
  }
  /* ── reviews ────────────────────────────────── */
  addReview(i) {
    const t = { ...i, status: "pending", createdAt: Date.now() };
    this.reviewMap.set(i.id, t), this.logActivity(i.agentId, "review_request", i.title), this.emit("reviewAdded", t);
  }
  resolveReview(i, t) {
    const s = this.reviewMap.get(i);
    if (s) {
      s.status = t, this.logActivity(s.agentId, "system", `Review "${s.title}" ${t}`);
      const e = this.agents.get(s.agentId);
      e && this.spawnEventParticles(e, t === "approved" ? "review_approved" : "review_rejected");
    }
  }
  getReviews() {
    return [...this.reviewMap.values()];
  }
  getPendingReviews() {
    return this.getReviews().filter((i) => i.status === "pending");
  }
  clearReviews() {
    this.reviewMap.clear();
  }
  /* ── events ─────────────────────────────────── */
  on(i, t) {
    this.events.has(i) || this.events.set(i, /* @__PURE__ */ new Set()), this.events.get(i).add(t);
  }
  off(i, t) {
    var s;
    (s = this.events.get(i)) == null || s.delete(t);
  }
  emit(i, ...t) {
    var s;
    (s = this.events.get(i)) == null || s.forEach((e) => e(...t));
  }
  /* ── lifecycle ──────────────────────────────── */
  destroy() {
    var i;
    this.engine.stop(), (i = this.resizeObserver) == null || i.disconnect(), this.canvas.removeEventListener("click", this.onClick), this.canvas.remove(), this.agents.clear(), this.events.clear();
  }
  /* ── internals ──────────────────────────────── */
  spawnEventParticles(i, t) {
    this.renderer.spawnEventParticles(i.gridX, i.gridY, t);
  }
  teleport(i, t) {
    i.x = t.x, i.y = t.y, i.gridX = t.x, i.gridY = t.y, i.isAtDesk = !0;
    const s = this.world.zones.find((e) => e.id === i.currentZoneId);
    s && (i.direction = s.facingDirection);
  }
  /** Force a resize recalculation (e.g. after sidebar toggle) */
  resize() {
    this.syncSize();
  }
  syncSize() {
    const i = this.container.getBoundingClientRect(), t = window.devicePixelRatio || 1, s = i.width * t, e = i.height * t;
    this.renderer.resize(s, e);
    const l = this.world.gridWidth * this.tileSize, n = this.world.gridHeight * this.tileSize;
    this.scale = Math.max(1, Math.min((s - 8) / l, (e - 8) / n)), this.renderer.setScale(this.scale);
  }
  update(i) {
    for (const t of this.agents.values()) {
      const s = t.isWalking, e = t.portalState !== "none";
      if (t.update(i), s && !t.isWalking && t.currentZoneId !== null) {
        t.isAtDesk = !0, t.isRoaming = !1;
        const l = this.world.zones.find((n) => n.id === t.currentZoneId);
        l && (t.direction = l.facingDirection);
      }
      if (e && t.portalState === "none" && t.currentZoneId !== null) {
        t.isAtDesk = !0, t.isRoaming = !1;
        const l = this.world.zones.find((n) => n.id === t.currentZoneId);
        l && (t.direction = l.facingDirection), this.spawnEventParticles(t, "task_picked");
      }
      if (t.socialAction !== "none" && (t.socialTimer -= i, t.socialTimer <= 0 && this.endSocialAction(t)), !t.isWalking && t.portalState === "none" && t.isAtDesk && t.socialAction === "none" && (t.movementTimer -= i, t.movementTimer <= 0 && (this.scheduleMovement(t), t.resolvedActivity === "idle" && (t.movementTimer = 3 + Math.random() * 3))), !t.isWalking && t.portalState === "none" && t.isAtDesk && t.socialAction === "none" && (t.coffeeBreakTimer -= i, t.coffeeBreakTimer <= 0 && (this.startCoffeeBreak(t), t.coffeeBreakTimer = 30 + Math.random() * 20)), !t.isWalking && t.portalState === "none" && t.isAtDesk && t.socialAction === "none" && Math.random() < i * 0.08 && this.tryStartConversation(t), !t.isWalking && t.portalState === "none" && t.isAtDesk && t.socialAction === "none" && Math.random() < i * 0.01)
        for (const l of this.agents.values()) {
          if (l.id === t.id || l.isWalking || l.socialAction !== "none") continue;
          if (Math.abs(l.gridX - t.gridX) + Math.abs(l.gridY - t.gridY) <= 4) {
            this.triggerHighFive(t);
            break;
          }
        }
      if (!t.isWalking && t.portalState === "none" && t.isAtDesk && t.socialAction === "none" && Math.random() < i * 5e-3 && (t.socialAction = "stretching", t.socialTimer = 2 + Math.random() * 1, t.message = "Stretching...", t.messageTimer = 2), this.currentEnv === "rocket" && !t.isWalking && t.isAtDesk && t.socialAction === "none") {
        const l = t.currentZoneType;
        (l === "engine_bay" || l === "fuselage_work" || l === "tool_bench") && Math.random() < i * 0.5 && this.renderer.spawnWeldingSparks(t.gridX, t.gridY);
      }
      t.resolvedActivity === "idle" && !t.isWalking && t.portalState === "none" && t.socialAction === "none" && (t.idleMessageTimer -= i, t.idleMessageTimer <= 0 && (t.message = nt[Math.floor(Math.random() * nt.length)], t.messageTimer = 3 + Math.random() * 2, t.idleMessageTimer = 5 + Math.random() * 8)), !t.isWalking && t.portalState === "none" && t.isAtDesk && t.socialAction === "none" && t.activeTaskCount > 1 && Math.random() < i * 0.08 && this.checkMultiTaskPortal(t);
    }
    this.renderer.updateParticles(i);
    for (let t = this.flyingTasks.length - 1; t >= 0; t--) {
      const s = this.flyingTasks[t];
      s.progress += i / s.duration, s.progress >= 1 && (this.renderer.spawnEventParticles(Math.round(s.toGX), Math.round(s.toGY), "task_picked"), this.flyingTasks.splice(t, 1));
    }
  }
  endSocialAction(i) {
    const t = i.socialAction;
    if (i.socialAction = "none", i.socialTimer = 0, i.message = null, i.socialPartnerId) {
      const s = this.agents.get(i.socialPartnerId);
      s && s.socialAction !== "none" && (s.socialAction = "none", s.socialTimer = 0, s.socialPartnerId = null, s.message = null), i.socialPartnerId = null;
    }
    i.movementTimer = 4 + Math.random() * 5, t === "high_five" && this.renderer.spawnEventParticles(i.gridX, i.gridY, "task_completed");
  }
  startCoffeeBreak(i) {
    if (this.world.zones.filter(
      (s) => (s.type === "break_area" || s.type === "town_bench_zone" || s.type === "town_square") && !s.assignedAgentId
    ).length === 0) {
      i.socialAction = "stretching", i.socialTimer = 2, i.message = "Stretching...", i.messageTimer = 2;
      return;
    }
    i.socialAction = "coffee_break", i.socialTimer = 4 + Math.random() * 2, i.message = "Coffee break ☕", i.messageTimer = 5;
  }
  tryStartConversation(i) {
    const t = [];
    for (const l of this.agents.values()) {
      if (l.id === i.id || l.isWalking || l.socialAction !== "none") continue;
      Math.abs(l.gridX - i.gridX) + Math.abs(l.gridY - i.gridY) <= 8 && t.push(l);
    }
    if (t.length === 0) return;
    const s = t[Math.floor(Math.random() * t.length)], e = 4 + Math.random() * 4;
    i.socialAction = "chatting", i.socialTimer = e, i.socialPartnerId = s.id, i.message = `Discussing ${i.currentObjectiveId ? "sprint" : "ideas"}...`, i.messageTimer = e, s.socialAction = "chatting", s.socialTimer = e, s.socialPartnerId = i.id, s.message = "Chatting...", s.messageTimer = e, s.gridX > i.gridX ? (i.direction = "right", s.direction = "left") : s.gridX < i.gridX ? (i.direction = "left", s.direction = "right") : s.gridY > i.gridY ? (i.direction = "down", s.direction = "up") : (i.direction = "up", s.direction = "down");
  }
  /** Called when a task completes — triggers high-five between agents */
  triggerHighFive(i) {
    let t = null, s = 1 / 0;
    for (const e of this.agents.values()) {
      if (e.id === i.id || e.isWalking || e.socialAction !== "none") continue;
      const l = Math.abs(e.gridX - i.gridX) + Math.abs(e.gridY - i.gridY);
      l < s && l <= 6 && (s = l, t = e);
    }
    i.socialAction = "high_five", i.socialTimer = 2, i.message = "Task done! 🎉", i.messageTimer = 3, t && (t.socialAction = "high_five", t.socialTimer = 2, t.socialPartnerId = i.id, t.message = "Nice work!", t.messageTimer = 3, i.socialPartnerId = t.id), this.renderer.spawnEventParticles(i.gridX, i.gridY, "task_completed");
  }
  /* ── task visualization ────────────────────── */
  spawnFlyingTask(i, t) {
    const s = this.stageConfigs.findIndex((f) => f.id === t), e = this.stageConfigs.findIndex((f) => f.id === i.stage);
    if (s < 0 || e < 0) return;
    const l = this.currentEnv === "town" ? s + 1 : s, n = this.currentEnv === "town" ? e + 1 : e, o = this.world.rooms.find((f) => f.id === l), a = this.world.rooms.find((f) => f.id === n);
    if (!o || !a) return;
    const r = o.bounds.x + o.bounds.w / 2, h = o.bounds.y + o.bounds.h / 2, c = a.bounds.x + a.bounds.w / 2, d = a.bounds.y + a.bounds.h / 2;
    this.flyingTasks.push({
      taskId: i.id,
      title: i.title,
      priority: i.priority,
      fromGX: r,
      fromGY: h,
      toGX: c,
      toGY: d,
      progress: 0,
      duration: 1.5
    });
  }
  computeTaskVisualization() {
    var a;
    if (this.taskVizCache && !this.taskVizDirty) return this.taskVizCache;
    const i = [], t = [], s = [];
    let e = null;
    const l = this.activeWorkspaceId ? this.workspaces.get(this.activeWorkspaceId) : null, n = l ? new Set(l.agentIds) : null, o = (a = l == null ? void 0 : l.taskFilter) != null && a.storyIds ? new Set(l.taskFilter.storyIds) : null;
    for (let r = 0; r < this.stageConfigs.length; r++) {
      const h = this.stageConfigs[r];
      let c = this.getTasksByStage(h.id);
      (n || o) && (c = c.filter((A) => o && A.storyId && o.has(A.storyId) || n && A.assigneeId && n.has(A.assigneeId) ? !0 : !n && !o));
      const d = this.currentEnv === "town" ? r + 1 : r, f = this.world.rooms.find((A) => A.id === d);
      if (!f || (s.push({
        roomId: d,
        count: c.length,
        bounds: f.bounds
      }), h.id === "done" && (e = {
        count: c.length,
        gridX: f.bounds.x + Math.floor(f.bounds.w / 2),
        gridY: f.bounds.y + f.bounds.h - 2,
        roomH: f.bounds.h,
        roomX: f.bounds.x,
        roomW: f.bounds.w
      }), c.length === 0)) continue;
      const g = this.computeItemPositions(f, c.length), u = c.length > g.length, b = u ? g.length - 1 : g.length;
      for (let A = 0; A < b; A++) {
        const m = c[A], k = g[A], S = !!(m.assigneeId && this.isAgentInRoom(m.assigneeId, d));
        i.push({
          taskId: m.id,
          title: m.title,
          priority: m.priority,
          assigneeId: m.assigneeId,
          stage: m.stage,
          gridX: k.x,
          gridY: k.y,
          isBeingWorked: S
        });
      }
      if (u) {
        const A = g[g.length - 1];
        t.push({
          roomId: d,
          count: c.length - b,
          gridX: A.x,
          gridY: A.y
        });
      }
    }
    return this.taskVizCache = { items: i, completionBag: e, flyingTasks: this.flyingTasks, overflows: t, stageCounts: s }, this.taskVizDirty = !1, this.taskVizCache;
  }
  computeItemPositions(i, t) {
    var n, o;
    const s = [], e = /* @__PURE__ */ new Set();
    for (const a of this.world.zones)
      a.roomId === i.id && (e.add(`${a.position.x},${a.position.y}`), e.add(`${a.position.x},${a.position.y - 1}`), e.add(`${a.position.x + 1},${a.position.y - 1}`));
    const l = i.bounds.y + Math.floor(i.bounds.h / 2) - 1;
    for (let a = i.bounds.y; a < l && s.length < t; a++)
      for (let r = i.bounds.x; r < i.bounds.x + i.bounds.w && s.length < t; r++) {
        const h = `${r},${a}`;
        e.has(h) || (o = (n = this.world.tiles[a]) == null ? void 0 : n[r]) != null && o.walkable && s.push({ x: r, y: a });
      }
    return s;
  }
  isAgentInRoom(i, t) {
    const s = this.agents.get(i);
    if (!s) return !1;
    const e = s.currentZoneId !== null ? this.world.zones.find((l) => l.id === s.currentZoneId) : null;
    return (e == null ? void 0 : e.roomId) === t;
  }
  /** Multi-task agents portal-jump between rooms with different tasks */
  checkMultiTaskPortal(i) {
    if (this.currentRoomMode !== "kanban" || i.isWalking || i.portalState !== "none" || i.resolvedActivity === "idle") return;
    const t = this.getTasks().filter(
      (r) => r.assigneeId === i.id && r.stage !== "done" && r.stage !== "backlog"
    );
    if (t.length <= 1) return;
    const s = /* @__PURE__ */ new Set();
    for (const r of t) {
      const h = this.stageConfigs.findIndex((d) => d.id === r.stage);
      if (h < 0) continue;
      const c = this.currentEnv === "town" ? h + 1 : h;
      s.add(c);
    }
    if (s.size <= 1) return;
    const e = i.currentZoneId !== null ? this.world.zones.find((r) => r.id === i.currentZoneId) : null, l = (e == null ? void 0 : e.roomId) ?? -1, n = [...s].filter((r) => r !== l);
    if (n.length === 0) return;
    const o = n[Math.floor(Math.random() * n.length)], a = this.world.zones.find((r) => !r.assignedAgentId && r.roomId === o);
    a && (i.currentZoneId !== null && this.world.freeZone(i.id), i.currentZoneId = a.id, i.currentZoneType = a.type, this.world.assignZone(a.id, i.id), i.isAtDesk = !1, i.isRoaming = !0, i.portalTo(a.position), this.taskVizDirty = !0, this.spawnEventParticles(i, "task_picked"));
  }
  render() {
    const i = this.computeTaskVisualization();
    this.renderer.render([...this.agents.values()], i);
  }
};
H.ACTIVITY_STAGE = {
  planning: "todo",
  analyzing: "todo",
  decomposing: "todo",
  searching: "todo",
  reading: "todo",
  grepping: "todo",
  coding: "in_progress",
  generating: "in_progress",
  refactoring: "in_progress",
  testing: "review",
  linting: "review",
  validating: "review",
  committing: "review",
  pushing: "review",
  deploying: "review",
  reviewing: "review",
  waiting_approval: "review",
  blocked: "review",
  success: "done",
  idle: "backlog"
}, H.ORCHESTRATOR_ROOM_ID = 9e3, H.MANAGER_ROLES = /\b(lead|manager|director|architect|pm|scrum\s*master|cto|vp|head)\b/i;
let rt = H;
export {
  rt as AgentTown,
  ht as DEFAULT_STAGES
};
