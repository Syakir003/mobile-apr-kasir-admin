import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Client Supabase global. Test widget tidak boleh mengevaluasi provider ini
/// (Supabase.initialize tidak dipanggil di test) — override repository /
/// caller provider di atasnya, pola yang sama seperti era Firestore.
final supabaseProvider = Provider<SupabaseClient>(
  (ref) => Supabase.instance.client,
);
