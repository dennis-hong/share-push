import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import { StyleSheet } from 'react-native';

export default function App() {
  return (
      <WebView
          style={styles.container}
          source={{ uri: 'https://dennis.k8s.kr/' }}
      />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginTop: Constants.statusBarHeight,
  },
});
