// 呼叫既有 room-manager 的 /rooms/:id/reset，確保場景對應的房間在
// exploit 腳本執行前後都回到乾淨狀態（room-manager 本身已實作
// docker compose up -d --force-recreate）。
function createRoomManagerClient({ baseUrl, adminToken, fetchImpl = fetch }) {
  async function reset(roomId) {
    const res = await fetchImpl(`${baseUrl}/rooms/${roomId}/reset`, {
      method: 'POST',
      headers: { 'x-admin-token': adminToken },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`room-manager reset ${roomId} failed: ${res.status} ${body}`);
    }
    return res.json();
  }

  return { reset };
}

module.exports = { createRoomManagerClient };
