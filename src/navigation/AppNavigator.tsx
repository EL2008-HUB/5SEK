import React, { useEffect, useRef } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Shadows } from "../theme";
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
import DuelsScreen from "../screens/DuelsScreen";
import LeaderboardScreen from "../screens/LeaderboardScreen";
import UpgradeAccountScreen from "../screens/UpgradeAccountScreen";
import DuelDetailScreen from "../screens/DuelDetailScreen";
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

const TAB_LABELS: Record<string, string> = {
  Home: "Kreu",
  Duels: "Duele",
  Record: "5 SEK",
  Feed: "Feed",
  Profile: "Profili",
};

function RecordTabIcon({ focused }: { focused: boolean }) {
  return (
    <View style={[tabStyles.recordOuter, focused && tabStyles.recordOuterActive]}>
      <LinearGradient
        colors={Colors.accent.primaryGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={tabStyles.recordInner}
      >
        <Text style={tabStyles.recordText}>5</Text>
      </LinearGradient>
    </View>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color }) => {
          if (route.name === "Record") return <RecordTabIcon focused={focused} />;

          let iconName: keyof typeof Ionicons.glyphMap = "home";
          if (route.name === "Home") iconName = focused ? "home" : "home-outline";
          else if (route.name === "Duels") iconName = focused ? "flash" : "flash-outline";
          else if (route.name === "Feed") iconName = focused ? "play-circle" : "play-circle-outline";
          else if (route.name === "Profile") iconName = focused ? "person" : "person-outline";

          return <Ionicons name={iconName} size={24} color={color} />;
        },
        tabBarLabel: TAB_LABELS[route.name] || route.name,
        tabBarActiveTintColor: "#FF2D6A",
        tabBarInactiveTintColor: "rgba(255,255,255,0.45)",
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: "#0A0A10",
          borderTopColor: "rgba(255,45,106,0.18)",
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 58 + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 6,
          elevation: 0,
        },
        tabBarItemStyle: { paddingVertical: 2 },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "700",
        },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Home" component={HomeWithRecordIntent} />
      <Tab.Screen name="Duels" component={DuelsScreen} />
      <Tab.Screen
        name="Record"
        component={RecordScreen}
        options={{
          tabBarLabelStyle: { fontSize: 11, fontWeight: "900", marginTop: 2 },
        }}
      />
      <Tab.Screen name="Feed" component={FeedScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const tabStyles = StyleSheet.create({
  recordOuter: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginTop: -18,
    padding: 3,
    backgroundColor: "#0A0A10",
    borderWidth: 1,
    borderColor: "rgba(255,45,106,0.35)",
    ...Shadows.glowPrimary,
  },
  recordOuterActive: {
    borderColor: "#FF2D6A",
    transform: [{ scale: 1.06 }],
  },
  recordInner: {
    flex: 1,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  recordText: {
    color: "#FFF",
    fontSize: 22,
    fontWeight: "900",
  },
});

function navigateFromDeepLink(navigationRef: any, url: string) {
  const target = parseDeepLinkTarget(url);
  if (!target || !navigationRef?.isReady?.()) return false;

  try {
    if (target.type === "deep_answer") {
      navigationRef.navigate("DeepAnswer", { answerId: String(target.answerId) });
      return true;
    }
    if (target.type === "challenge") {
      navigationRef.navigate("Challenge", { answerId: String(target.answerId) });
      return true;
    }
    if (target.type === "duel") {
      navigationRef.navigate("DuelLink", { duelId: String(target.duelId) });
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
            Duels: "duels",
            Record: "record",
            Feed: "feed",
            Profile: "profile",
          },
        },
        // Deep link for shared answers (viral loop)
        DeepAnswer: "answer/:answerId",
        // Alternate path: /a/:answerId (short URL)
        DeepAnswer2: "a/:answerId",
        Challenge: "c/:answerId",
        DuelLink: "d/:duelId",
        TextAnswer: "text-answer",
        AudioAnswer: "audio-answer",
        Leaderboard: "leaderboard",
        UpgradeAccount: "upgrade",
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
            <Stack.Screen name="Challenge" component={DeepAnswerScreen} />
            <Stack.Screen name="DuelLink" component={DuelDetailScreen} />
            <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
            <Stack.Screen
              name="UpgradeAccount"
              component={UpgradeAccountScreen}
              options={{ animation: "slide_from_bottom" }}
            />
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
