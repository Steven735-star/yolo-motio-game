export function createPoseSocket(onMessage) {
  const socket = new WebSocket("ws://localhost:8000/ws/pose");

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    onMessage(data);
  };

  return socket;
}