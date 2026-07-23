import React, { useEffect, useRef } from "react";
import { Linking } from "react-native";
import {
  NavigationContainer,
  useNavigation,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import HomeScreen from "../screens/HomeScreen";
import RecordScreen from "../screens/RecordScreen";
import FeedScreen from "../screens/FeedScreen";
import ProfileScreen from "../screens/ProfileScreen";
import TextAnswerScreen from "../screens/TextAnswerScreen";
import AudioAnswerScreen from "../screens/AudioAnswerScreen";
import DeepAnswerScreen from "../screens/DeepAnswerScreen";
import RemixRecordScreen from "../screens/RemixRecordScreen";
import AuthScreen from "../screens/AuthScreen";
import FirstSessionFlowScreen, {
  consumePendingRecordIntent,
} from "../screens/FirstSessionFlowScreen";
import TrendingScreen from "../screens/TrendingScreen";
import { isAllowedDeepLink } from "../services/deepLinks";
import {
  consumePendingDeepLink,
  parseDeepLinkTarget,
  stashPendingDeepLink,
} from "../services/pendingDeepLink";
import { navigationIntegration } from "../services/observability";
import { useAuth } from "../context/AuthContext";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/** Runs inside the tab navigator so navigate("Record") resolves. */
function HomeWithRecordIntent(props: any) {
  const navigation = useNavigation<any>();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const shouldOpenRecord = await consumePendingRecordIntent();
      if (!cancelled && shouldOpenRecord) {
        timer = setTimeout(() => {
          navigation.navigate("Record");
        }, 80);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [navigation]);

  return <HomeScreen {...props} />;
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = "home";

          if (route.name === "Home") iconName = focused ? "home" : "home-outline";
          else if (route.name === "Trending") iconName = focused ? "flame" : "flame-outline";
          else if (route.name === "Record") iconName = focused ? "radio-button-on" : "radio-button-off";
          else if (route.name === "Feed") iconName = focused ? "play-circle" : "play-circle-outline";
          else if (route.name === "Profile") iconName = focused ? "person" : "person-outline";

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: "#FF3366",
        tabBarInactiveTintColor: "#888",
        tabBarStyle: {
          backgroundColor: "#0A0A0A",
          borderTopColor: "#1A1A2E",
          borderTopWidth: 1,
          height: 90,
          paddingBottom: 30,
          paddingTop: 10,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Home" component={HomeWithRecordIntent} />
      <Tab.Screen name="Trending" component={TrendingScreen} />
      <Tab.Screen
        name="Record"
        component={RecordScreen}
        options={{
          tabBarLabel: "5 SEK",
          tabBarIconStyle: { transform: [{ scale: 1.3 }] },
        }}
      />
      <Tab.Screen name="Feed" component={FeedScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function navigateFromDeepLink(navigationRef: any, url: string) {
  const target = parseDeepLinkTarget(url);
  if (!target || !navigationRef?.isReady?.()) return false;

  try {
    if (target.type === "deep_answer") {
      navigationRef.navigate("DeepAnswer", { answerId: String(target.answerId) });
      return true;
    }
    if (target.type === "remix") {
      navigationRef.navigate("RemixRecord", { parentAnswerId: target.parentAnswerId });
      return true;
    }
    if (target.type === "question") {
      navigationRef.navigate("Main", {
        screen: "Record",
        params: { questionId: target.questionId },
      });
      return true;
    }
    if (target.type === "tab") {
      navigationRef.navigate("Main", {
        screen: target.screen,
        params: target.answerId ? { answerId: target.answerId } : undefined,
      });
      return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

export default function AppNavigator() {
  const { user, needsFirstSession, completeFirstSession } = useAuth();
  const navigationRef = useNavigationContainerRef();
  const canHandleDeepLinks = Boolean(user) && !needsFirstSession;
  const canHandleRef = useRef(canHandleDeepLinks);
  canHandleRef.current = canHandleDeepLinks;

  const linking: any = {
    prefixes: [
      "five-second://",
      "exp://",
      "https://5sek.app",
      "https://www.5sek.app",
      "https://app.5sek.app",
    ] as string[],
    config: {
      screens: {
        Main: {
          screens: {
            Home: "home",
            Trending: "trending",
            Record: "record",
            Feed: "feed",
            Profile: "profile",
          },
        },
        // Deep link for shared answers (viral loop)
        DeepAnswer: "answer/:answerId",
        // Alternate path: /a/:answerId (short URL)
        DeepAnswer2: "a/:answerId",
        TextAnswer: "text-answer",
        AudioAnswer: "audio-answer",
        // Remix chain deep link
        RemixRecord: "remix/:parentAnswerId",
      },
    },
    // 🔥 Always enabled — critical for growth loop
    enabled: true,
  };

  // Capture cold-start / gated deep links so they survive Auth + FirstSession.
  useEffect(() => {
    let cancelled = false;

    const capture = async (url: string | null) => {
      if (cancelled || !url || !isAllowedDeepLink(url)) return;
      if (canHandleRef.current && navigationRef.isReady()) {
        navigateFromDeepLink(navigationRef, url);
        return;
      }
      await stashPendingDeepLink(url);
    };

    Linking.getInitialURL()
      .then((url) => capture(url))
      .catch(() => {});

    const sub = Linking.addEventListener("url", ({ url }) => {
      capture(url).catch(() => {});
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [navigationRef]);

  // Replay stashed deep link after the user can navigate the full stack.
  useEffect(() => {
    if (!canHandleDeepLinks) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      const url = await consumePendingDeepLink();
      if (cancelled || !url) return;

      timer = setTimeout(() => {
        if (!cancelled) {
          navigateFromDeepLink(navigationRef, url);
        }
      }, 120);
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [canHandleDeepLinks, navigationRef]);

  return (
    <NavigationContainer
      linking={linking}
      ref={navigationRef}
      onReady={() => {
        navigationIntegration.registerNavigationContainer(navigationRef);
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          needsFirstSession ? (
            <Stack.Screen name="FirstSession">
              {() => (
                <FirstSessionFlowScreen
                  onComplete={async () => {
                    await completeFirstSession();
                  }}
                />
              )}
            </Stack.Screen>
          ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="TextAnswer" component={TextAnswerScreen} />
            <Stack.Screen name="AudioAnswer" component={AudioAnswerScreen} />
            <Stack.Screen name="DeepAnswer" component={DeepAnswerScreen} />
            <Stack.Screen name="DeepAnswer2" component={DeepAnswerScreen} />
            <Stack.Screen
              name="RemixRecord"
              component={RemixRecordScreen}
              options={{ animation: "slide_from_bottom" }}
            />
          </>
          )
        ) : (
          <Stack.Screen name="Auth" component={AuthScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
