(function () {
  const ROUNDS_KEY = "golfRounds";
  const SELECTED_DATE_KEY = "golfSelectedDate";
  const LEGACY_KEY = "golfScoreDemo";
  const PARS_KEY = "golfParSettings";
  const MAX_SHOTS = 12;
  const HOLE_COUNT = 18;
  const firebaseConfig = {
    apiKey: "AIzaSyBlEmOMjyLFrD46RqsqGHtiwSaUPuF8YjI",
    authDomain: "golfscore-6fa24.firebaseapp.com",
    projectId: "golfscore-6fa24",
    storageBucket: "golfscore-6fa24.firebasestorage.app",
    messagingSenderId: "700627397157",
    appId: "1:700627397157:web:55f6eaedab8373f5e66dcc",
    measurementId: "G-MGKFXNF3MC"
  };
  const sdkBase = "https://www.gstatic.com/firebasejs/10.12.2/";
  let rounds = [];
  let parSettings = createDefaultPars();
  let currentUser = null;
  let firestore = null;
  let cloudReady = false;
  let writeQueue = Promise.resolve();
  let readyPromise = null;

  function today() {
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 10);
  }

  function createDefaultPars() {
    return Array.from({ length: HOLE_COUNT }, () => 4);
  }

  function createEmptyScores() {
    return Array.from({ length: HOLE_COUNT }, () =>
      Array.from({ length: MAX_SHOTS }, () => ({ club: "－", rating: "－", approach: false, bunker: false }))
    );
  }

  function readLocalRounds() {
    try {
      const saved = JSON.parse(localStorage.getItem(ROUNDS_KEY) || "null");
      if (Array.isArray(saved) && saved.length) {
        return saved.filter(round => round && /^\d{4}-\d{2}-\d{2}$/.test(round.date) && Array.isArray(round.data));
      }
    } catch (error) {}

    let initialData = createEmptyScores();
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
      if (Array.isArray(legacy) && legacy.length === HOLE_COUNT) initialData = legacy;
    } catch (error) {}
    return [{ date: today(), courseName: "", data: initialData }];
  }

  function readLocalPars() {
    try {
      const saved = JSON.parse(localStorage.getItem(PARS_KEY) || "null");
      if (Array.isArray(saved) && saved.length === HOLE_COUNT) {
        return saved.map(value => {
          const par = Number(value);
          return Number.isInteger(par) && par >= 3 && par <= 6 ? par : 4;
        });
      }
    } catch (error) {}
    return createDefaultPars();
  }

  function saveLocalCache() {
    localStorage.setItem(ROUNDS_KEY, JSON.stringify(rounds));
    localStorage.setItem(PARS_KEY, JSON.stringify(parSettings));
  }

  function loadSdkScript(fileName) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = sdkBase + fileName;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Firebase SDKの読み込みに失敗しました: ${fileName}`));
      document.head.appendChild(script);
    });
  }

  async function loadFirebaseSdk() {
    await loadSdkScript("firebase-app-compat.js");
    await loadSdkScript("firebase-auth-compat.js");
    await loadSdkScript("firebase-firestore-compat.js");
    const app = firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth(app);
    firestore = firebase.firestore(app);
    const credential = await auth.signInAnonymously();
    currentUser = credential.user;
  }

  function userDocument() {
    return firestore.collection("users").doc(currentUser.uid);
  }

  function saveRoundsToCache() {
    localStorage.setItem(ROUNDS_KEY, JSON.stringify(rounds));
  }

  function toFirestoreRound(round) {
    const holes = {};
    round.data.forEach((shots, index) => {
      holes[String(index)] = shots;
    });
    return { ...round, data: holes };
  }

  function fromFirestoreRound(round, documentId) {
    let data;
    if (Array.isArray(round.data)) {
      data = round.data;
    } else if (round.data && typeof round.data === "object") {
      data = Array.from({ length: HOLE_COUNT }, (_, index) => {
        const shots = round.data[String(index)];
        return Array.isArray(shots) ? shots : [];
      });
    } else {
      data = createEmptyScores();
    }
    return {
      ...round,
      date: round.date || documentId,
      courseName: round.courseName || "",
      data
    };
  }

  function queueCloudWrite(write) {
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      if (!cloudReady && readyPromise) await readyPromise;
      if (!cloudReady || !currentUser) throw new Error("Firestoreに接続されていません");
      await write(userDocument());
    }).catch(error => {
      console.error("Firestore write failed:", error);
    });
    return writeQueue;
  }

  function queueRoundSave(round) {
    const snapshot = JSON.parse(JSON.stringify(round));
    return queueCloudWrite(user => user.collection("rounds").doc(snapshot.date).set(toFirestoreRound(snapshot)));
  }

  function parseParSettings(value) {
    if (!Array.isArray(value) || value.length !== HOLE_COUNT) return null;
    return value.map(item => {
      const par = Number(item);
      return Number.isInteger(par) && par >= 3 && par <= 6 ? par : 4;
    });
  }

  async function initializeCloud() {
    document.body.style.pointerEvents = "none";
    try {
      await loadFirebaseSdk();
      const user = userDocument();
      const [roundSnapshot, parSnapshot] = await Promise.all([
        user.collection("rounds").get(),
        user.collection("settings").doc("pars").get()
      ]);

      if (roundSnapshot.empty) {
        rounds = readLocalRounds();
        await Promise.all(rounds.map(round => user.collection("rounds").doc(round.date).set(toFirestoreRound(round))));
      } else {
        rounds = roundSnapshot.docs.map(doc => {
          return fromFirestoreRound(doc.data(), doc.id);
        }).filter(round => /^\d{4}-\d{2}-\d{2}$/.test(round.date) && Array.isArray(round.data));
      }

      if (parSnapshot.exists) {
        parSettings = parseParSettings(parSnapshot.data().values) || createDefaultPars();
      } else {
        parSettings = readLocalPars();
        await user.collection("settings").doc("pars").set({ values: parSettings });
      }

      if (!rounds.length) {
        rounds = [{ date: today(), courseName: "", data: createEmptyScores() }];
        await user.collection("rounds").doc(rounds[0].date).set(toFirestoreRound(rounds[0]));
      }
      saveLocalCache();
      const selectedDate = localStorage.getItem(SELECTED_DATE_KEY);
      if (!rounds.some(round => round.date === selectedDate)) {
        const latestDate = rounds.reduce((latest, round) => round.date > latest ? round.date : latest, rounds[0].date);
        localStorage.setItem(SELECTED_DATE_KEY, latestDate);
      }
      cloudReady = true;
      return true;
    } catch (error) {
      console.error("Firestore initialization failed:", error);
      rounds = readLocalRounds();
      parSettings = readLocalPars();
      saveLocalCache();
      const selectedDate = localStorage.getItem(SELECTED_DATE_KEY);
      if (!rounds.some(round => round.date === selectedDate)) localStorage.setItem(SELECTED_DATE_KEY, rounds[0].date);
      return false;
    } finally {
      document.body.style.pointerEvents = "";
    }
  }

  function getRounds() {
    return rounds.slice().sort((a, b) => b.date.localeCompare(a.date));
  }

  function getSelectedDate() {
    const selectedDate = localStorage.getItem(SELECTED_DATE_KEY);
    if (rounds.some(round => round.date === selectedDate)) return selectedDate;
    const fallbackDate = rounds[0]?.date || today();
    localStorage.setItem(SELECTED_DATE_KEY, fallbackDate);
    return fallbackDate;
  }

  function getRound(date = getSelectedDate()) {
    return rounds.find(round => round.date === date) || null;
  }

  function setSelectedDate(date) {
    if (!getRound(date)) return false;
    localStorage.setItem(SELECTED_DATE_KEY, date);
    return true;
  }

  function saveScores(data, date = getSelectedDate()) {
    const round = getRound(date);
    if (!round) return false;
    round.data = data;
    saveRoundsToCache();
    queueRoundSave(round);
    return true;
  }

  function addRound(date, courseName = "") {
    if (rounds.some(round => round.date === date)) return false;
    const round = { date, courseName: String(courseName).trim(), data: createEmptyScores() };
    rounds.push(round);
    saveRoundsToCache();
    localStorage.setItem(SELECTED_DATE_KEY, date);
    queueRoundSave(round);
    return true;
  }

  function renameRound(oldDate, newDate, courseName) {
    const round = getRound(oldDate);
    if (!round || (oldDate !== newDate && rounds.some(item => item.date === newDate))) return false;
    const wasSelected = localStorage.getItem(SELECTED_DATE_KEY) === oldDate;
    round.date = newDate;
    if (courseName !== undefined) round.courseName = String(courseName).trim();
    saveRoundsToCache();
    if (wasSelected) localStorage.setItem(SELECTED_DATE_KEY, newDate);
    const snapshot = JSON.parse(JSON.stringify(round));
    queueCloudWrite(async user => {
      await user.collection("rounds").doc(newDate).set(toFirestoreRound(snapshot));
      if (oldDate !== newDate) await user.collection("rounds").doc(oldDate).delete();
    });
    return true;
  }

  function setCourseName(courseName, date = getSelectedDate()) {
    const round = getRound(date);
    if (!round) return false;
    round.courseName = String(courseName).trim();
    saveRoundsToCache();
    queueRoundSave(round);
    return true;
  }

  function deleteRound(date) {
    if (rounds.length <= 1 || !getRound(date)) return false;
    rounds = rounds.filter(round => round.date !== date);
    saveRoundsToCache();
    if (localStorage.getItem(SELECTED_DATE_KEY) === date) {
      const latestDate = rounds.reduce((latest, round) => round.date > latest ? round.date : latest, rounds[0].date);
      localStorage.setItem(SELECTED_DATE_KEY, latestDate);
    }
    queueCloudWrite(user => user.collection("rounds").doc(date).delete());
    return true;
  }

  function getParSettings() {
    return parSettings.slice();
  }

  function saveParSettings(values) {
    const parsed = parseParSettings(values);
    if (!parsed) return false;
    parSettings = parsed;
    localStorage.setItem(PARS_KEY, JSON.stringify(parSettings));
    const snapshot = parsed.slice();
    queueCloudWrite(user => user.collection("settings").doc("pars").set({ values: snapshot }));
    return true;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[character]);
  }

  readyPromise = initializeCloud();
  window.GolfData = {
    ready: readyPromise,
    today,
    getRounds,
    getSelectedDate,
    getRound,
    setSelectedDate,
    setCourseName,
    getParSettings,
    saveParSettings,
    escapeHtml,
    saveScores,
    addRound,
    renameRound,
    deleteRound
  };
})();
