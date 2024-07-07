import React, { useEffect, useState, useRef, useCallback } from 'react';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import { StyleSheet, View, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function registerForPushNotificationsAsync() {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!');
      return;
    }
    token = (await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig.extra.eas.projectId,
    })).data;
  } else {
    console.log('Must use physical device for Push Notifications');
  }

  return token;
}

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

async function sendTokenToServer(token, sessionData, retryCount = 0) {
  try {
    let userId = null;
    let isGuest = true;

    if (sessionData && sessionData.user && sessionData.user.id) {
      userId = sessionData.user.id;
      isGuest = false;
    }

    const response = await fetch('https://share-push-web.vercel.app/api/pushes/saveToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token,
        deviceInfo: {
          os: Platform.OS,
          model: Device.modelName,
        },
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save token');
    }

    const data = await response.json();
    console.log(data.message);
  } catch (error) {
    console.error('Error sending token to server:', error);

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying... Attempt ${retryCount + 1} of ${MAX_RETRIES}`);
      await retry(() => sendTokenToServer(token, sessionData, retryCount + 1));
    } else {
      console.error('Max retries reached. Failed to send token to server.');
    }
  }
}

function retry(fn, delay = RETRY_DELAY) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(fn()), delay);
  });
}

export default function App() {
  const [expoPushToken, setExpoPushToken] = useState('');
  const [sessionData, setSessionData] = useState(null);
  const [appIsReady, setAppIsReady] = useState(false);
  const notificationListener = useRef();
  const responseListener = useRef();
  const webViewRef = useRef(null);

  const updateToken = useCallback(async () => {
    try {
      const token = await registerForPushNotificationsAsync();
      if (token !== expoPushToken) {
        setExpoPushToken(token);
        if (token) {
          await sendTokenToServer(token, sessionData);
        }
      }
    } catch (error) {
      console.error('Error updating token:', error);
    }
  }, [expoPushToken, sessionData]);

  useEffect(() => {
    async function prepare() {
      try {
        await updateToken();

        notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
          console.log(notification);
          if (webViewRef.current) {
            webViewRef.current.postMessage(JSON.stringify({
              type: 'NOTIFICATION_RECEIVED',
              notification: notification
            }));
          }
        });

        responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
          console.log(response);
          if (webViewRef.current) {
            webViewRef.current.postMessage(JSON.stringify({
              type: 'NOTIFICATION_RESPONSE',
              response: response
            }));
          }
        });

        setAppIsReady(true);
      } catch (e) {
        console.warn(e);
      }
    }

    prepare();

    const tokenRefreshInterval = setInterval(updateToken, 24 * 60 * 60 * 1000);

    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
      clearInterval(tokenRefreshInterval);
    };
  }, [updateToken]);

  const onLayoutRootView = useCallback(async () => {
    if (appIsReady) {
      await SplashScreen.hideAsync();
    }
  }, [appIsReady]);

  const handleMessage = useCallback((event) => {
    const data = JSON.parse(event.nativeEvent.data);
    if (data.type === 'GET_PUSH_TOKEN') {
      webViewRef.current.postMessage(JSON.stringify({
        type: 'PUSH_TOKEN',
        token: expoPushToken
      }));
    } else if (data.type === 'SESSION_UPDATE') {
      setSessionData(data.session);
      updateToken();
    }
  }, [expoPushToken, updateToken]);

  if (!appIsReady) {
    return null;
  }

  return (
      <View style={styles.container} onLayout={onLayoutRootView}>
        <WebView
            ref={webViewRef}
            style={styles.webview}
            source={{ uri: 'https://share-push-web.vercel.app/' }}
            onMessage={handleMessage}
            userAgent="Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36"
            injectedJavaScript={`
          window.addEventListener('message', function(event) {
            if (event.data && event.data.type === 'SESSION_UPDATE') {
              window.ReactNativeWebView.postMessage(JSON.stringify(event.data));
            }
          });
        `}
        />
      </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
});