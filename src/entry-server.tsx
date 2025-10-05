
import App from "./App";
import './index.css'

function ServerEntry() {
  return (
    <App/>
  );
}

export async function fetchData() {
  return { user: 'xxx' }
}


export { ServerEntry };
