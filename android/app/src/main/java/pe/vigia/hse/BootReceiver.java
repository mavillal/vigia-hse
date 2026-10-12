package pe.vigia.hse;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Abre el player apenas el stick termina de encender (tras un corte de luz, por ejemplo). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String a = intent.getAction();
        if (!a.equals(Intent.ACTION_BOOT_COMPLETED) && !a.endsWith("QUICKBOOT_POWERON")) return;
        Intent i = new Intent(context, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(i);
        } catch (Exception ignored) {
            // Sin permiso de inicio automático en Android 10+: queda el ícono en el inicio.
        }
    }
}
