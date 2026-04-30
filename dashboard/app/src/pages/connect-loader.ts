import { isRedirect, redirect } from "@tanstack/react-router";
import { api } from "@/api/client";
import i18n from "@/i18n";
import {
  consumeConnectBootstrap,
  initializeConnectBootstrapFromLocation,
} from "@/lib/connect-bootstrap";
import { setApiKey } from "@/lib/session";

export interface ConnectRouteLoaderData {
  hasBootstrapParams: boolean;
  initialError: string;
  initialInput: string;
}

const EMPTY_CONNECT_ROUTE_LOADER_DATA: ConnectRouteLoaderData = {
  hasBootstrapParams: false,
  initialError: "",
  initialInput: "",
};

function getInvalidConnectErrorMessage(): string {
  return i18n.t("connect.error.invalid");
}

export async function loadConnectRouteData(): Promise<ConnectRouteLoaderData> {
  initializeConnectBootstrapFromLocation();

  const bootstrap = consumeConnectBootstrap();
  if (!bootstrap.hasBootstrapParams) {
    return EMPTY_CONNECT_ROUTE_LOADER_DATA;
  }

  if (!bootstrap.autoConnectKey) {
    return {
      hasBootstrapParams: true,
      initialError: "",
      initialInput: bootstrap.initialInput,
    };
  }

  try {
    await api.verifySpace(bootstrap.autoConnectKey);
    setApiKey(bootstrap.autoConnectKey, false);
    throw redirect({ replace: true, to: "/space" });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }

    return {
      hasBootstrapParams: true,
      initialError: getInvalidConnectErrorMessage(),
      initialInput: bootstrap.initialInput,
    };
  }
}
