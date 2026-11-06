import React, { createContext, useContext } from 'react';

export interface AuthenticatedUser {
    email: string | null;
    name: string;
    role: string;
}

export interface AuthContextValue {
    authenticated: boolean;
    user: AuthenticatedUser | null;
    isCreator: boolean;
    googleLinked: boolean;
}

export const DEFAULT_AUTH_CONTEXT: AuthContextValue = {
    authenticated: false,
    user: null,
    isCreator: false,
    googleLinked: false
};

const AuthContext = createContext<AuthContextValue>(DEFAULT_AUTH_CONTEXT);

export const AuthProvider = AuthContext.Provider;

export function useAuth(): AuthContextValue {
    return useContext(AuthContext);
}
